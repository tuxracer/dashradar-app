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
import { track } from "@vercel/analytics";
import { useSettings } from "@/context/SettingsContext";
import { isWasmSafeModeArmed } from "@/lib/backendSafeMode";
import { waitForNextVideoFrame } from "@/lib/camera";
import {
  clearSentinel,
  HEARTBEAT_INTERVAL_MS,
  writeHeartbeat,
} from "@/lib/crashSentinel";
import type { HudModel } from "@/lib/detection";
import { buildHudModel, toRoadDetections } from "@/lib/detection";
import { createDetectionTracker } from "@/lib/detectionTracker";
import { contactDirection, signalFromScore } from "@/lib/radarSignal";
import { waitForServiceWorkerControl } from "@/lib/serviceWorker";
import { POLICE_LABEL } from "@/workers/detection/consts";
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
  MIN_FRAME_INTERVAL_MS,
  PACING_REST_RATIO,
  POLICE_EVENT_DEBOUNCE_MS,
  SW_CONTROL_TIMEOUT_MS,
  WORKER_RECYCLE_AFTER_MS,
} from "./consts";
import type {
  Contact,
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
};

export const DetectionProvider = ({
  children,
  createWorker = createDetectionWorker,
}: DetectionProviderProps) => {
  const { showDebug, settingsOpen } = useSettings();
  // Mirrors showDebug for sendFrame, which is a stable callback: the pump
  // reads the current value per capture instead of re-subscribing on toggles.
  const includeFrameRef = useRef(showDebug);
  useEffect(() => {
    includeFrameRef.current = showDebug;
  }, [showDebug]);

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
  const [error, setError] = useState<DetectionErrorCode>();
  // fps and the per-frame debug snapshot update on every result, but nothing
  // renders them by default (the debug overlay and settings panel are hidden),
  // so they live in refs read via getFps()/getDebugSnapshot() instead of state
  // that would re-render every consumer per frame.
  const fpsRef = useRef(0);
  const debugRef = useRef<DebugSnapshot>(INITIAL_DEBUG);
  const [contact, setContact] = useState<Contact>();
  // Mirrors `contact` so the previous bitmap can be closed from event
  // handlers without a side effect inside a setState updater (StrictMode
  // double-invokes updaters; see statusRef above).
  const contactRef = useRef<Contact | undefined>(undefined);

  /** Swap in the next contact (or none), closing the previous crop bitmap. */
  const replaceContact = useCallback((next: Contact | undefined) => {
    contactRef.current?.image.close();
    contactRef.current = next;
    setContact(next);
  }, []);

  // Mirror backend and the probe's graph-capture flag into refs so the crash
  // sentinel heartbeat effect below can key on [status] alone. Keying it on
  // backend/backendProbe too would tear the effect down and restart it every
  // time a recycled worker re-reports them, resetting startedAt and the frames
  // baseline mid-session and destroying the uptime the sentinel exists to
  // collect. The heartbeat reads these refs inside its interval instead.
  const backendRef = useRef(backend);
  useEffect(() => {
    backendRef.current = backend;
  }, [backend]);
  const graphCaptureRef = useRef(backendProbe?.graphCapture);
  useEffect(() => {
    graphCaptureRef.current = backendProbe?.graphCapture;
  }, [backendProbe]);

  // React 19 useRef requires an initial value; undefined unions cover "not yet set".
  const workerRef = useRef<DetectionWorkerLike | undefined>(undefined);
  // performance.now() at the moment the current worker was created, so the
  // "detections" handler can recycle it once WORKER_RECYCLE_AFTER_MS has
  // elapsed. Only same-load comparisons are made, so performance.now (which is
  // monotonic within a page load) is the correct clock here.
  const workerCreatedAtRef = useRef(0);
  // False from the moment a worker is spawned until it reports `ready`, then
  // false again if it errors. The pump bails while it is false so a detect
  // frame is never posted to a worker whose model has not loaded (the worker
  // silently drops it, which would strand inFlightRef at 1 and deadlock the
  // pump forever). Before the periodic recycle, statusRef === "ready" always
  // implied a loaded worker; a recycle can leave the pump in "running"/"ready"
  // with a fresh, still-loading worker, so this ref makes the load state
  // explicit rather than inferred from status. Set in spawnWorker and the
  // `ready`/error handlers.
  const workerLoadedRef = useRef(false);
  // Guards the one-time ready analytics (backend_resolved/model_ready) so a
  // recycled worker's `ready` does not re-fire them, which would otherwise
  // inflate the counts every WORKER_RECYCLE_AFTER_MS of a scanning session.
  const readyTrackedRef = useRef(false);
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
  // Pending pacing timeout scheduled by schedulePacedFrame; cleared wherever
  // the pump is torn down so a stale timer can't pump a stopped session.
  const paceTimerRef = useRef<number | undefined>(undefined);
  // True when the pump was stopped because the page went hidden, so the
  // visibility handler knows to restart it (and only it) on return.
  const pausedByVisibilityRef = useRef(false);
  // True when the pump was stopped because the settings panel opened, so the
  // settings effect knows to restart it (and only it) when the panel closes.
  const pausedBySettingsRef = useRef(false);
  const fileProgressRef = useRef(new Map<string, ModelProgress>());
  // Whether the model loaded from the runtime cache, captured from
  // `model-load-start` so the `model_ready` analytics event fired on `ready`
  // can report cache hits against fresh downloads.
  const modelFromCacheRef = useRef(false);
  // Running total of detections results received this page load, incremented
  // in the "detections" handler body (never a setState updater, which
  // StrictMode double-invokes). The heartbeat effect below reads this against
  // a baseline captured when it starts, so framesProcessed in the sentinel
  // record counts only frames from the current running span.
  const framesTotalRef = useRef(0);
  const resultTimesRef = useRef<number[]>([]);
  // Capture duration of the most recently posted frame and the timestamp it was
  // posted, paired with the next detections result for the debug snapshot.
  const lastCaptureMsRef = useRef(0);
  const postTimeRef = useRef(0);
  // performance.now() of the last frame police were detected in, for the
  // debounced `police_detected` analytics event. Negative infinity (not 0,
  // which is only ~page-load and would swallow a sighting in the first 30 s)
  // means never seen this session, so the first sighting always reads as a
  // fresh encounter and fires the event.
  const lastPoliceSeenAtRef = useRef(Number.NEGATIVE_INFINITY);
  // Holds the latest `sendFrame` so the retry timeout can call it without
  // closing over the `const` before its own initializer finishes (which
  // `react-hooks/immutability` flags as a before-declaration access).
  const sendFrameRef = useRef<() => Promise<void>>(async () => {});
  // Coasting tracker: shows each detection immediately and holds a stale box
  // for a few frames when the model briefly loses it, smoothing flicker. Held
  // in a ref so state survives across frames and re-renders.
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
    if (!workerLoadedRef.current) {
      // A recycle (or the initial load) left a worker that has not reported
      // `ready` yet; it would silently drop this frame and strand the in-flight
      // count, deadlocking the pump. The worker's `ready` handler re-primes.
      return;
    }
    if (inFlightRef.current > 0) {
      // A frame is already at the worker; its result will re-prime the pump.
      return;
    }
    const generation = pumpGenerationRef.current;
    try {
      // Hold the capture until the camera presents a new frame, so inference
      // never runs twice on the same frame when detection outpaces the camera.
      // The wait can outlive the pump (rVFC does not fire while hidden), so
      // re-check the guards before committing to a capture.
      await waitForNextVideoFrame(video);
      if (
        generation !== pumpGenerationRef.current ||
        !runningRef.current ||
        inFlightRef.current > 0
      ) {
        return;
      }
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
      inFlightRef.current += 1;
      worker.postMessage(
        { type: "detect", frame, includeFrame: includeFrameRef.current },
        [frame],
      );
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

  /**
   * Re-prime the pump after a result, delaying so captures never start less
   * than MIN_FRAME_INTERVAL_MS apart and the pump always rests at least
   * PACING_REST_RATIO of the last round trip. On fast devices the absolute
   * floor dominates, idling the GPU between frames instead of running
   * back-to-back; on devices slower than the floor the rest ratio takes over,
   * guaranteeing idle time proportional to how long inference takes so the
   * GPU never runs at a 100% duty cycle on a dash-mounted phone.
   */
  const schedulePacedFrame = useCallback((elapsedSincePostMs: number) => {
    const floorDelay = Math.max(0, MIN_FRAME_INTERVAL_MS - elapsedSincePostMs);
    const restDelay = PACING_REST_RATIO * elapsedSincePostMs;
    const delay = Math.max(floorDelay, restDelay);
    // Record the decision for the debug overlay's pacing row. The result
    // handler has already written this frame's snapshot, so merge onto it.
    debugRef.current = {
      ...debugRef.current,
      pacingDelayMs: delay,
      pacingRule: floorDelay >= restDelay ? "floor" : "rest",
    };
    paceTimerRef.current = window.setTimeout(() => {
      void sendFrameRef.current();
    }, delay);
  }, []);

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
        fpsRef.current = Math.round(((times.length - 1) * 1000) / elapsed);
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

  useEffect(() => {
    // Defer the model download until a service worker controls the page so its
    // fetch flows through Workbox's runtime cache on a first visit. In dev
    // there is no service worker, so load immediately. `cancelled` guards
    // against React StrictMode tearing the effect down before control arrives,
    // and equally guards a recycled worker's load if the effect tears down
    // while it is pending. On a recycle the service worker already controls the
    // page, so the wait resolves immediately; that path is not special-cased.
    let cancelled = false;
    const requestLoad = (worker: DetectionWorkerLike) => {
      const startLoad = import.meta.env.PROD
        ? waitForServiceWorkerControl(SW_CONTROL_TIMEOUT_MS)
        : Promise.resolve();
      void startLoad.then(() => {
        if (cancelled) {
          return;
        }
        // forceWasm re-reads per load post (mount and each recycle), so a
        // safe mode armed at startup governs every session of this page load.
        worker.postMessage({ type: "load", forceWasm: isWasmSafeModeArmed() });
      });
    };

    const handleMessage = (event: MessageEvent) => {
      const message: unknown = event.data;
      if (!isWorkerResponse(message)) {
        return;
      }
      switch (message.type) {
        case "model-load-start": {
          setDownloadingModel(!message.fromCache);
          modelFromCacheRef.current = message.fromCache;
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
          // Mark the worker loaded before priming the pump below, so the
          // sendFrame() call in the running branch is not itself bailed.
          workerLoadedRef.current = true;
          setBackend(message.backend);
          // Report which execution provider this device resolved to and how
          // the weights loaded. The two are the app's core health signals: with
          // no backend there is no other view into the GPU/CPU split or how
          // often the runtime cache is actually hit. Emitted from the message
          // handler body, not a setState updater, so StrictMode's double-invoke
          // of updaters can't double-count them. Gated to the first ready of the
          // page load: a periodic worker recycle produces a fresh `ready` every
          // WORKER_RECYCLE_AFTER_MS, which must not re-fire these events.
          if (!readyTrackedRef.current) {
            readyTrackedRef.current = true;
            track("backend_resolved", { backend: message.backend });
            track("model_ready", {
              backend: message.backend,
              fromCache: modelFromCacheRef.current,
            });
          }
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
          framesTotalRef.current += 1;
          const roadDetections = toRoadDetections(message.detections);
          const tracked = trackerRef.current?.update(roadDetections) ?? [];
          setHud(buildHudModel(tracked));
          // Pair the crop with its detection. Validation mirrors the road
          // filter; a crop whose detection is dropped is discarded so the
          // card never shows evidence the HUD pipeline would not count.
          if (message.crop) {
            const [cropDetection] = toRoadDetections([
              message.detections[message.crop.detectionIndex],
            ]);
            if (cropDetection) {
              replaceContact({
                image: message.crop.image,
                frame: message.frame,
                score: cropDetection.score,
                signal: signalFromScore(cropDetection.score),
                box: cropDetection.box,
                direction: contactDirection(cropDetection.box),
                at: performance.now(),
              });
            } else {
              message.crop.image.close();
            }
          }
          // Report an anonymous police sighting to analytics on the leading
          // edge only: fire when police appear, then stay quiet until they have
          // been absent for POLICE_EVENT_DEBOUNCE_MS, so following a car
          // continuously collapses into one event. Nothing identifying the
          // sighting leaves the device, only the event count. Read the fresh
          // per-frame detections (not the coasting `tracked` set) so a briefly
          // held stale box does not keep the debounce alive. Kept out of the
          // setHud updater above: StrictMode double-invokes updaters, which
          // would double-count the sighting.
          if (roadDetections.some((d) => d.label === POLICE_LABEL)) {
            const now = performance.now();
            if (now - lastPoliceSeenAtRef.current >= POLICE_EVENT_DEBOUNCE_MS) {
              track("police_detected");
            }
            lastPoliceSeenAtRef.current = now;
          }
          const { preprocessMs, inferenceMs, decodeMs } = message.timing;
          const roundTripMs = performance.now() - postTimeRef.current;
          debugRef.current = {
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
            shownCount: tracked.length,
            // Carried forward for one line; schedulePacedFrame below writes
            // this frame's actual pacing decision.
            pacingDelayMs: debugRef.current.pacingDelayMs,
            pacingRule: debugRef.current.pacingRule,
          };
          recordResultTime();
          // Recycle the worker once it has been running long enough, at this
          // result boundary where nothing is in flight (inFlightRef was just
          // decremented to 0), so no frame is lost. Terminating and recreating
          // the worker resets the native memory that ORT and the GPU stack leak
          // across thousands of runs; see WORKER_RECYCLE_AFTER_MS. Status stays
          // "running" throughout, so the new worker's `ready` re-primes the
          // pump through the handler above (runningRef is true). The recycle
          // replaces schedulePacedFrame: the new worker's first frame is pumped
          // by that ready, not by a paced timer on the terminated worker.
          if (
            runningRef.current &&
            performance.now() - workerCreatedAtRef.current >=
              WORKER_RECYCLE_AFTER_MS
          ) {
            workerRef.current?.terminate();
            // Invalidate any capture from the old pump so it can't post onto
            // the new worker, and drop the in-flight count to 0 for the restart.
            pumpGenerationRef.current += 1;
            inFlightRef.current = 0;
            window.clearTimeout(retryTimerRef.current);
            window.clearTimeout(paceTimerRef.current);
            const next = spawnWorker();
            requestLoad(next);
          } else {
            schedulePacedFrame(roundTripMs);
          }
          break;
        }
        case "worker-error": {
          track("error", { code: message.code });
          setError(message.code);
          statusRef.current = "error";
          setStatus("error");
          runningRef.current = false;
          workerLoadedRef.current = false;
          pumpGenerationRef.current += 1;
          inFlightRef.current = 0;
          window.clearTimeout(retryTimerRef.current);
          window.clearTimeout(paceTimerRef.current);
          replaceContact(undefined);
          break;
        }
      }
    };

    const handleError = () => {
      track("error", { code: "WORKER_CRASHED" });
      setError("WORKER_CRASHED");
      statusRef.current = "error";
      setStatus("error");
      runningRef.current = false;
      workerLoadedRef.current = false;
      pumpGenerationRef.current += 1;
      inFlightRef.current = 0;
      window.clearTimeout(retryTimerRef.current);
      window.clearTimeout(paceTimerRef.current);
      replaceContact(undefined);
    };

    // Create a worker, wire its handlers, and record its birth time. Used by
    // both the initial mount and the periodic recycle; the recycle path pairs
    // it with requestLoad above to re-download (from cache) the weights.
    const spawnWorker = (): DetectionWorkerLike => {
      const worker = createWorker();
      workerRef.current = worker;
      workerCreatedAtRef.current = performance.now();
      // Fresh worker: its model is not loaded until it reports `ready`.
      workerLoadedRef.current = false;
      worker.onmessage = handleMessage;
      worker.onerror = handleError;
      return worker;
    };

    const worker = spawnWorker();
    requestLoad(worker);
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimerRef.current);
      window.clearTimeout(paceTimerRef.current);
      replaceContact(undefined);
      // Terminate whichever worker is current, which is the recycled one if a
      // recycle has happened, not the one spawned at mount.
      workerRef.current?.terminate();
    };
  }, [
    createWorker,
    recordResultTime,
    replaceContact,
    schedulePacedFrame,
    sendFrame,
  ]);

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
    window.clearTimeout(paceTimerRef.current);
    // Confirmation is wall-clock-age based, so a track left pending across a
    // long stop() would otherwise confirm on the first matched frame after
    // restart. A resumed session must re-earn confirmation from scratch.
    trackerRef.current = createDetectionTracker();
    if (statusRef.current === "running") {
      statusRef.current = "ready";
      setStatus("ready");
    }
  }, []);

  // Pause the pump while the page is hidden (app switched away, screen off).
  // rAF loops throttle on their own, but the pump is driven by worker results,
  // so without this it keeps capturing and running inference in the background
  // until the OS freezes the tab. `stop`/`start` already handle the in-flight
  // races; the ref restricts the resume to sessions this handler paused, so a
  // visibility bounce never starts a pump the user hadn't started.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        if (runningRef.current) {
          pausedByVisibilityRef.current = true;
          stop();
        }
        return;
      }
      if (pausedByVisibilityRef.current) {
        pausedByVisibilityRef.current = false;
        const video = videoRef.current;
        if (video) {
          start(video);
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [start, stop]);

  // Pause the pump while the full-screen settings panel is open. Settings is a
  // same-page overlay, so it never triggers visibilitychange; without this the
  // pump keeps capturing and running inference behind the panel, burning
  // battery and thermal budget the user can't see any result from. Mirrors the
  // visibility pause: the ref restricts the resume to sessions this effect
  // paused, so closing the panel never starts a pump the user hadn't started
  // (e.g. one still on the model-load screen). The `runningRef` guard makes it
  // idempotent, so the effect re-running on a `start`/`stop` identity change
  // while the panel is open never double-stops or re-pauses.
  useEffect(() => {
    if (settingsOpen) {
      if (runningRef.current) {
        pausedBySettingsRef.current = true;
        stop();
      }
      return;
    }
    if (pausedBySettingsRef.current) {
      pausedBySettingsRef.current = false;
      const video = videoRef.current;
      if (video) {
        start(video);
      }
    }
  }, [settingsOpen, start, stop]);

  // Crash sentinel heartbeat: while detection is running, write a timestamped
  // record to localStorage on a fixed cadence so the NEXT launch can tell
  // whether this session ended cleanly. The pump already leaves "running" via
  // stop() on page-hidden, settings-open, and user stop, so this effect's
  // cleanup running on any of those exits clears the sentinel; only an
  // OS-level kill mid-scan (no JS runs, so nothing else can react) leaves the
  // last heartbeat in place for the next launch to read and report to Sentry.
  // Keyed on [status] alone so startedAt and the frames baseline span the whole
  // running session: backend and graphCapture are read from refs inside the
  // interval instead of being deps, because a periodic worker recycle re-posts
  // backend-probe and would otherwise restart this effect every recycle,
  // resetting the uptime the sentinel exists to collect.
  useEffect(() => {
    if (status !== "running") {
      return;
    }
    const startedAt = Date.now();
    const baseline = framesTotalRef.current;
    const beat = () => {
      writeHeartbeat({
        startedAt,
        lastBeatAt: Date.now(),
        framesProcessed: framesTotalRef.current - baseline,
        backend: backendRef.current,
        graphCapture: graphCaptureRef.current,
      });
    };
    // A reload or navigation away mid-scan unloads the page without ever
    // running this effect's cleanup (React does not flush cleanups during
    // unload), which would orphan the record and make the next launch read a
    // plain reload as a crash, wrongly arming the WASM safe mode. pagehide is
    // the last synchronous chance to clear it, and a real crash never fires
    // pagehide, so genuine kills still leave the record behind. If the page
    // returns from the bfcache instead of unloading, the still-running
    // interval rewrites the record on its next tick, restoring coverage.
    const handlePageHide = () => {
      clearSentinel();
    };
    window.addEventListener("pagehide", handlePageHide);
    beat();
    const intervalId = window.setInterval(beat, HEARTBEAT_INTERVAL_MS);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      window.clearInterval(intervalId);
      clearSentinel();
    };
  }, [status]);

  const getFps = useCallback(() => fpsRef.current, []);

  const getDebugSnapshot = useCallback(() => debugRef.current, []);

  const value = useMemo(
    () => ({
      status,
      backend,
      backendProbe,
      mainThreadWebGpu,
      downloadingModel,
      modelProgress,
      hud,
      getFps,
      getDebugSnapshot,
      error,
      contact,
      start,
      stop,
    }),
    [
      status,
      backend,
      backendProbe,
      mainThreadWebGpu,
      downloadingModel,
      modelProgress,
      hud,
      getFps,
      getDebugSnapshot,
      error,
      contact,
      start,
      stop,
    ],
  );

  return (
    <DetectionContext.Provider value={value}>
      {children}
    </DetectionContext.Provider>
  );
};
