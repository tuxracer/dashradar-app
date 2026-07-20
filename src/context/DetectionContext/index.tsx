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
import { createDetectionTracker } from "@/lib/detectionTracker";
import { createMotionSensorManager } from "@/lib/motionSensor";
import type {
  MotionPermission,
  MotionSensorManager,
  YawPitch,
} from "@/lib/motionSensor";
import { waitForServiceWorkerControl } from "@/lib/serviceWorker";
import type {
  BackendProbe,
  DetectionBackend,
  DetectionErrorCode,
} from "@/workers/detection/types";
import { isWorkerResponse } from "@/workers/detection/types";
import {
  FPS_SAMPLE_SIZE,
  FRAME_RETRY_MS,
  INITIAL_DEBUG,
  SW_CONTROL_TIMEOUT_MS,
} from "./consts";
import type {
  DebugSnapshot,
  DetectionContextValue,
  DetectionStatus,
  DetectionWorkerLike,
  MainThreadWebGpu,
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
  /** Test seam: defaults to the real motion-sensor manager. */
  createMotionManager?: () => MotionSensorManager;
};

export const DetectionProvider = ({
  children,
  createWorker = createDetectionWorker,
  createMotionManager = createMotionSensorManager,
}: DetectionProviderProps) => {
  const [status, setStatus] = useState<DetectionStatus>("loading-model");
  const [backend, setBackend] = useState<DetectionBackend>();
  const [backendProbe, setBackendProbe] = useState<BackendProbe>();
  const [mainThreadWebGpu, setMainThreadWebGpu] = useState<MainThreadWebGpu>();
  const [downloadingModel, setDownloadingModel] = useState(false);
  const [modelProgress, setModelProgress] = useState<ModelProgress>({
    loadedBytes: 0,
    totalBytes: 0,
  });
  const [hud, setHud] = useState<HudModel>();
  const [fps, setFps] = useState(0);
  const [debug, setDebug] = useState<DebugSnapshot>(INITIAL_DEBUG);
  const [error, setError] = useState<DetectionErrorCode>();
  const [motionPermission, setMotionPermission] =
    useState<MotionPermission>("unsupported");

  // React 19 useRef requires an initial value; undefined unions cover "not yet set".
  const workerRef = useRef<DetectionWorkerLike | undefined>(undefined);
  // The motion manager is created once. A ref (not useMemo) keeps it stable
  // across renders and reachable from the sendFrame/result handlers.
  const motionRef = useRef<MotionSensorManager | undefined>(undefined);
  // Orientation snapshot taken at the moment a frame is captured, and the
  // reference orientation for the currently displayed detection. Only one
  // frame is ever in flight, so a single capture ref suffices.
  const captureOrientationRef = useRef<YawPitch>({ yaw: 0, pitch: 0 });
  const referenceOrientationRef = useRef<YawPitch>({ yaw: 0, pitch: 0 });
  const videoRef = useRef<HTMLVideoElement | undefined>(undefined);
  const runningRef = useRef(false);
  // Mirrors `status` so event handlers can branch on the current status
  // without putting side effects inside setStatus updater functions (React
  // double-invokes updaters under StrictMode, which would double-pump).
  // Every setStatus call site updates this ref alongside it.
  const statusRef = useRef<DetectionStatus>("loading-model");
  // Count of detect frames posted to the worker whose results have not come
  // back yet. The pump bails while this is nonzero, so a stale result from
  // before a stop()/start() re-primes the pipeline at depth 1 instead of
  // stacking a second frame on top of the restarted pump's frame.
  const inFlightRef = useRef(0);
  // Bumped on stop() and worker errors so an in-flight createImageBitmap from
  // a previous pump run discards its frame instead of posting it. A bare
  // runningRef re-check after the await is not enough: a fast stop()-then-
  // start() flips runningRef back to true while the stale capture is still
  // pending, which would put two frames in flight.
  const pumpGenerationRef = useRef(0);
  const retryTimerRef = useRef<number | undefined>(undefined);
  const fileProgressRef = useRef(new Map<string, ModelProgress>());
  const resultTimesRef = useRef<number[]>([]);
  // Capture duration of the most recently posted frame and the timestamp it was
  // posted, paired with the next detections result for the debug snapshot.
  const lastCaptureMsRef = useRef(0);
  const postTimeRef = useRef(0);
  // Holds the latest `sendFrame` so the retry timeout can call it without
  // closing over the `const` before its own initializer finishes (which
  // `react-hooks/immutability` flags as a before-declaration access).
  const sendFrameRef = useRef<() => Promise<void>>(async () => {});
  // Persistence gate: only detections seen consistently for PERSIST_MS reach
  // the HUD. Held in a ref so state survives across frames and re-renders.
  const trackerRef = useRef<
    ReturnType<typeof createDetectionTracker> | undefined
  >(undefined);
  if (trackerRef.current == null) {
    trackerRef.current = createDetectionTracker();
  }

  const sendFrame = useCallback(async () => {
    const video = videoRef.current;
    const worker = workerRef.current;
    if (!runningRef.current || !video || !worker) {
      return;
    }
    if (inFlightRef.current > 0) {
      // A frame is already at the worker; its result will re-prime the pump.
      return;
    }
    const generation = pumpGenerationRef.current;
    try {
      const captureStart = performance.now();
      const frame = await createImageBitmap(video);
      if (
        generation !== pumpGenerationRef.current ||
        !runningRef.current ||
        inFlightRef.current > 0
      ) {
        // The pump was stopped (and possibly restarted) while this capture
        // was pending; the restarted pump owns the in-flight slot now.
        frame.close();
        return;
      }
      lastCaptureMsRef.current = performance.now() - captureStart;
      postTimeRef.current = performance.now();
      const capturedOrientation = motionRef.current?.getYawPitch() ?? {
        yaw: 0,
        pitch: 0,
      };
      captureOrientationRef.current = {
        yaw: capturedOrientation.yaw,
        pitch: capturedOrientation.pitch,
      };
      inFlightRef.current += 1;
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

  // Probe WebGPU adapter availability on the main thread once at startup. Read
  // against the worker's BackendProbe in the debug overlay, this separates a
  // device with no usable WebGPU anywhere from a worker-only limitation.
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      if (!("gpu" in navigator) || !navigator.gpu) {
        setMainThreadWebGpu("unsupported");
        return;
      }
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!cancelled) {
          setMainThreadWebGpu(adapter ? "adapter" : "no-adapter");
        }
      } catch {
        if (!cancelled) {
          setMainThreadWebGpu("error");
        }
      }
    };
    void probe();
    return () => {
      cancelled = true;
    };
  }, []);

  // Own the motion-sensor lifecycle. Integration runs whether or not permission
  // is granted; on iOS no devicemotion events fire until the user grants it, so
  // the orientation simply stays at zero (no compensation).
  useEffect(() => {
    const manager = createMotionManager();
    motionRef.current = manager;
    manager.start();
    // Seed the permission state from the freshly created manager. This effect
    // is the only place the manager's initial permission can be read, so
    // setting state directly here is intended, not a render-loop hazard.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMotionPermission(manager.getPermission());
    return () => {
      manager.stop();
      motionRef.current = undefined;
    };
  }, [createMotionManager]);

  useEffect(() => {
    const worker = createWorker();
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent) => {
      const message: unknown = event.data;
      if (!isWorkerResponse(message)) {
        return;
      }
      switch (message.type) {
        case "model-load-start": {
          setDownloadingModel(!message.fromCache);
          break;
        }
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
        case "backend-probe": {
          setBackendProbe(message.probe);
          break;
        }
        case "ready": {
          setBackend(message.backend);
          if (runningRef.current) {
            statusRef.current = "running";
            setStatus("running");
            void sendFrame();
          } else {
            statusRef.current = "ready";
            setStatus("ready");
          }
          break;
        }
        case "detections": {
          inFlightRef.current = Math.max(0, inFlightRef.current - 1);
          // The returned boxes correspond to the pose the frame was captured at,
          // not the pose now. Anchor compensation to that capture pose.
          referenceOrientationRef.current = captureOrientationRef.current;
          const roadDetections = toRoadDetections(message.detections);
          const confirmed =
            trackerRef.current?.update(roadDetections, performance.now()) ?? [];
          setHud(buildHudModel(confirmed));
          const { preprocessMs, inferenceMs, decodeMs } = message.timing;
          const roundTripMs = performance.now() - postTimeRef.current;
          setDebug({
            captureMs: lastCaptureMsRef.current,
            preprocessMs,
            inferenceMs,
            decodeMs,
            roundTripMs,
            // Round-trip time not accounted for by the worker's three stages:
            // postMessage delivery each way plus scheduling. Clamped at 0 to
            // absorb sub-millisecond cross-thread clock noise.
            overheadMs: Math.max(
              0,
              roundTripMs - (preprocessMs + inferenceMs + decodeMs),
            ),
            rawCount: message.detections.length,
            filteredCount: roadDetections.length,
            confirmedCount: confirmed.length,
          });
          recordResultTime();
          void sendFrame();
          break;
        }
        case "worker-error": {
          setError(message.code);
          statusRef.current = "error";
          setStatus("error");
          runningRef.current = false;
          pumpGenerationRef.current += 1;
          inFlightRef.current = 0;
          window.clearTimeout(retryTimerRef.current);
          break;
        }
      }
    };
    worker.onerror = () => {
      setError("WORKER_CRASHED");
      statusRef.current = "error";
      setStatus("error");
      runningRef.current = false;
      pumpGenerationRef.current += 1;
      inFlightRef.current = 0;
      window.clearTimeout(retryTimerRef.current);
    };
    // Defer the model download until a service worker controls the page so its
    // fetch flows through Workbox's runtime cache on a first visit. In dev
    // there is no service worker, so load immediately. `cancelled` guards
    // against React StrictMode tearing the effect down before control arrives.
    let cancelled = false;
    const startLoad = import.meta.env.PROD
      ? waitForServiceWorkerControl(SW_CONTROL_TIMEOUT_MS)
      : Promise.resolve();
    void startLoad.then(() => {
      if (cancelled) {
        return;
      }
      worker.postMessage({ type: "load" });
    });
    return () => {
      cancelled = true;
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
      // Branch on statusRef outside the setStatus updater: StrictMode
      // double-invokes updater functions, so a side effect (the frame pump)
      // inside one would post two frames per start().
      if (statusRef.current === "ready") {
        statusRef.current = "running";
        setStatus("running");
        void sendFrame();
      }
      // Otherwise stay as-is; the "ready" handler starts the pump via
      // runningRef when the model finishes loading.
    },
    [sendFrame],
  );

  const stop = useCallback(() => {
    runningRef.current = false;
    pumpGenerationRef.current += 1;
    window.clearTimeout(retryTimerRef.current);
    // Confirmation is wall-clock-age based, so a track left pending across a
    // long stop() would otherwise confirm on the first matched frame after
    // restart. A resumed session must re-earn confirmation from scratch.
    trackerRef.current = createDetectionTracker();
    if (statusRef.current === "running") {
      statusRef.current = "ready";
      setStatus("ready");
    }
  }, []);

  /** Angular delta (radians) between the live orientation and the pose the
   * currently displayed detection was captured at. */
  const getMotionDelta = useCallback((): YawPitch => {
    const current = motionRef.current?.getYawPitch() ?? { yaw: 0, pitch: 0 };
    const reference = referenceOrientationRef.current;
    return {
      yaw: current.yaw - reference.yaw,
      pitch: current.pitch - reference.pitch,
    };
  }, []);

  /** Requests iOS motion permission from a user gesture; no-op elsewhere. */
  const requestMotionPermission = useCallback(async () => {
    const manager = motionRef.current;
    if (!manager) {
      return;
    }
    setMotionPermission(await manager.requestPermission());
  }, []);

  const value = useMemo(
    () => ({
      status,
      backend,
      backendProbe,
      mainThreadWebGpu,
      downloadingModel,
      modelProgress,
      hud,
      fps,
      debug,
      error,
      start,
      stop,
      getMotionDelta,
      motionPermission,
      requestMotionPermission,
    }),
    [
      status,
      backend,
      backendProbe,
      mainThreadWebGpu,
      downloadingModel,
      modelProgress,
      hud,
      fps,
      debug,
      error,
      start,
      stop,
      getMotionDelta,
      motionPermission,
      requestMotionPermission,
    ],
  );

  return (
    <DetectionContext.Provider value={value}>
      {children}
    </DetectionContext.Provider>
  );
};
