import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { HudModel } from "@/lib/detection";
import { buildHudModel, toRoadDetections } from "@/lib/detection";
import type {
  DetectionBackend,
  DetectionErrorCode,
} from "@/workers/detection/types";
import { isWorkerResponse } from "@/workers/detection/types";
import { FPS_SAMPLE_SIZE, FRAME_RETRY_MS } from "./consts";
import type {
  DetectionContextValue,
  DetectionWorkerLike,
  ModelProgress,
} from "./types";

export * from "./consts";
export * from "./types";

const DetectionContext = createContext<DetectionContextValue | undefined>(
  undefined,
);

export const useDetection = (): DetectionContextValue => {
  const value = useContext(DetectionContext);
  if (!value) {
    throw new Error("useDetection must be used within a DetectionProvider");
  }
  return value;
};

const createDetectionWorker = (): DetectionWorkerLike => {
  return new Worker(
    new URL("../../workers/detection/index.ts", import.meta.url),
    { type: "module" },
  );
};

type DetectionProviderProps = {
  children: ReactNode;
  /** Test seam: defaults to the real detection worker. */
  createWorker?: () => DetectionWorkerLike;
};

export const DetectionProvider = ({
  children,
  createWorker = createDetectionWorker,
}: DetectionProviderProps) => {
  const [status, setStatus] = useState<
    "loading-model" | "ready" | "running" | "error"
  >("loading-model");
  const [backend, setBackend] = useState<DetectionBackend>();
  const [modelProgress, setModelProgress] = useState<ModelProgress>({
    loadedBytes: 0,
    totalBytes: 0,
  });
  const [hud, setHud] = useState<HudModel>();
  const [fps, setFps] = useState(0);
  const [error, setError] = useState<DetectionErrorCode>();

  // React 19 useRef requires an initial value; undefined unions cover "not yet set".
  const workerRef = useRef<DetectionWorkerLike | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement | undefined>(undefined);
  const runningRef = useRef(false);
  // Bumped on stop() and worker errors so an in-flight createImageBitmap from
  // a previous pump run discards its frame instead of posting it. A bare
  // runningRef re-check after the await is not enough: a fast stop()-then-
  // start() flips runningRef back to true while the stale capture is still
  // pending, which would put two frames in flight.
  const pumpGenerationRef = useRef(0);
  const retryTimerRef = useRef<number | undefined>(undefined);
  const fileProgressRef = useRef(new Map<string, ModelProgress>());
  const resultTimesRef = useRef<number[]>([]);
  // Holds the latest `sendFrame` so the retry timeout can call it without
  // closing over the `const` before its own initializer finishes (which
  // `react-hooks/immutability` flags as a before-declaration access).
  const sendFrameRef = useRef<() => Promise<void>>(async () => {});

  const sendFrame = useCallback(async () => {
    const video = videoRef.current;
    const worker = workerRef.current;
    if (!runningRef.current || !video || !worker) {
      return;
    }
    const generation = pumpGenerationRef.current;
    try {
      const frame = await createImageBitmap(video);
      if (generation !== pumpGenerationRef.current || !runningRef.current) {
        // The pump was stopped (and possibly restarted) while this capture
        // was pending; the restarted pump owns the in-flight slot now.
        frame.close();
        return;
      }
      worker.postMessage({ type: "detect", frame }, [frame]);
    } catch {
      if (generation !== pumpGenerationRef.current || !runningRef.current) {
        return;
      }
      // Video has no frame data yet (still attaching): retry shortly.
      retryTimerRef.current = window.setTimeout(() => {
        void sendFrameRef.current();
      }, FRAME_RETRY_MS);
    }
  }, []);
  useEffect(() => {
    sendFrameRef.current = sendFrame;
  }, [sendFrame]);

  const recordResultTime = useCallback(() => {
    const times = resultTimesRef.current;
    times.push(performance.now());
    if (times.length > FPS_SAMPLE_SIZE) {
      times.shift();
    }
    if (times.length >= 2) {
      const elapsed = times[times.length - 1] - times[0];
      // Two results inside the same millisecond would divide by zero; keep
      // the previous reading until a measurable interval accumulates.
      if (elapsed > 0) {
        setFps(Math.round(((times.length - 1) * 1000) / elapsed));
      }
    }
  }, []);

  useEffect(() => {
    const worker = createWorker();
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent) => {
      const message: unknown = event.data;
      if (!isWorkerResponse(message)) {
        return;
      }
      switch (message.type) {
        case "model-progress": {
          fileProgressRef.current.set(message.progress.file, {
            loadedBytes: message.progress.loaded,
            totalBytes: message.progress.total,
          });
          let loadedBytes = 0;
          let totalBytes = 0;
          for (const file of fileProgressRef.current.values()) {
            loadedBytes += file.loadedBytes;
            totalBytes += file.totalBytes;
          }
          setModelProgress({ loadedBytes, totalBytes });
          break;
        }
        case "ready": {
          setBackend(message.backend);
          if (runningRef.current) {
            setStatus("running");
            void sendFrame();
          } else {
            setStatus("ready");
          }
          break;
        }
        case "detections": {
          setHud(buildHudModel(toRoadDetections(message.detections)));
          recordResultTime();
          void sendFrame();
          break;
        }
        case "worker-error": {
          setError(message.code);
          setStatus("error");
          runningRef.current = false;
          pumpGenerationRef.current += 1;
          window.clearTimeout(retryTimerRef.current);
          break;
        }
      }
    };
    worker.onerror = () => {
      setError("WORKER_CRASHED");
      setStatus("error");
      runningRef.current = false;
      pumpGenerationRef.current += 1;
      window.clearTimeout(retryTimerRef.current);
    };
    worker.postMessage({ type: "load" });
    return () => {
      window.clearTimeout(retryTimerRef.current);
      worker.terminate();
    };
  }, [createWorker, recordResultTime, sendFrame]);

  const start = useCallback(
    (video: HTMLVideoElement) => {
      videoRef.current = video;
      if (runningRef.current) {
        return;
      }
      runningRef.current = true;
      setStatus((current) => {
        if (current === "ready") {
          void sendFrame();
          return "running";
        }
        return current;
      });
    },
    [sendFrame],
  );

  const stop = useCallback(() => {
    runningRef.current = false;
    pumpGenerationRef.current += 1;
    window.clearTimeout(retryTimerRef.current);
    setStatus((current) => (current === "running" ? "ready" : current));
  }, []);

  const value = useMemo(
    () => ({
      status,
      backend,
      modelProgress,
      hud,
      fps,
      error,
      start,
      stop,
    }),
    [status, backend, modelProgress, hud, fps, error, start, stop],
  );

  return (
    <DetectionContext.Provider value={value}>
      {children}
    </DetectionContext.Provider>
  );
};
