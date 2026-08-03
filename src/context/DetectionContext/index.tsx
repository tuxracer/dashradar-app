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
import { useSettings } from "@/context/SettingsContext";
import { APP_RELEASE } from "@/lib/appRelease";
import { waitForNextVideoFrame } from "@/lib/camera";
import {
  clearSentinel,
  heartbeatDelayMs,
  writeHeartbeat,
} from "@/lib/crashSentinel";
import type { HudModel } from "@/lib/detection";
import { resolveModels } from "@/lib/detectionModels";
import { createDetectionTelemetry } from "@/lib/detectionTelemetry";
import { createDetectionTracker } from "@/lib/detectionTracker";
import { processDetectionResult } from "@/lib/processDetectionResult";
import { waitForServiceWorkerControl } from "@/lib/serviceWorker";
import { ZOOM_2X, ZOOM_OFF } from "@/workers/detection/consts";
import type {
  BackendProbe,
  DetectionErrorCode,
  ZoomLevel,
} from "@/workers/detection/types";
import { isWorkerResponse } from "@/workers/detection/types";
import {
  FRAME_RETRY_MS,
  INITIAL_DEBUG,
  MIN_FRAME_INTERVAL_MS,
  PACING_REST_RATIO,
  SW_CONTROL_TIMEOUT_MS,
  WORKER_RECYCLE_AFTER_MS,
} from "./consts";
import type {
  Contact,
  DebugSnapshot,
  DetectionContextValue,
  DetectionStatus,
  DetectionWorkerLike,
  ModelProgress,
  ScanResult,
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
  const {
    detectionImage,
    throttleInference,
    zoomMode,
    confidenceThreshold,
    modelIds,
    settingsOpen,
  } = useSettings();
  // Pinned at mount, not tracked. Changing the model applies by reloading the
  // page (the model screen reloads on save), so a selection changed underneath
  // a live session must not reach it. The pin is what makes that true for the
  // periodic worker recycle too, which builds a new session 15 minutes in and
  // would otherwise pick up whatever is stored by then.
  const [activeModel] = useState(() => resolveModels(modelIds)[0]);
  // The analytics sink for this page load. Owns every once-per-load gate (the
  // worker recycle re-fires load and ready events that must not re-count) and
  // the scanning clock behind the timing and scan-session events. Lazy state
  // rather than a ref so one instance spans the provider's life; creating it
  // has no side effects, so a discarded StrictMode duplicate costs nothing.
  const [telemetry] = useState(() => createDetectionTelemetry(activeModel));
  // Mirrors the detection-image setting for sendFrame (which asks the worker
  // for the top detection's cutout only while the contact card exists to show
  // it) and the detections handler. A ref rather than a dependency so the
  // stable pump callbacks read the current value per capture.
  const detectionImageRef = useRef(detectionImage);
  useEffect(() => {
    detectionImageRef.current = detectionImage;
  }, [detectionImage]);
  // Mirrors the throttle flag for schedulePacedFrame, a stable callback that
  // reads it per result instead of re-subscribing. useSettings() already
  // reports the effective value: throttleInference can only be false while the
  // Developer options master switch is on, so the pacing floor comes back on
  // its own when that switch goes off, whatever is stored.
  const throttledRef = useRef(throttleInference);
  useEffect(() => {
    throttledRef.current = throttleInference;
  }, [throttleInference]);
  // Mirrors the zoom mode for sendFrame, same idiom again. Already gated on
  // Developer options, so a normal drive always scans the full centered square
  // and can never be left narrowed by a stale persisted mode.
  const zoomModeRef = useRef(zoomMode);
  useEffect(() => {
    zoomModeRef.current = zoomMode;
  }, [zoomMode]);
  // Crop factor and dimensions of the most recently posted frame. Only one
  // frame is ever in flight, so when a detections result arrives this always
  // describes the frame it came from; publishing the scan needs the frame's
  // geometry and the zoom it was captured at.
  const lastFrameInfoRef = useRef<
    { zoom: ZoomLevel; width: number; height: number } | undefined
  >(undefined);
  // Mirrors the effective minimum confidence for sendFrame and the detections
  // handler, both of which read it per result rather than re-subscribing.
  // useSettings() already gates it: it can only differ from the 0.5 floor while
  // developerOptions is on, so a normal drive always filters at 0.5.
  const confidenceThresholdRef = useRef(confidenceThreshold);
  useEffect(() => {
    confidenceThresholdRef.current = confidenceThreshold;
  }, [confidenceThreshold]);
  // Mirrors the panel state for start(), which is a stable callback the views
  // call from their own effects. Reading the ref keeps start() out of the
  // settings effect's dependency chain.
  const settingsOpenRef = useRef(settingsOpen);
  useEffect(() => {
    settingsOpenRef.current = settingsOpen;
  }, [settingsOpen]);

  const [status, setStatus] = useState<DetectionStatus>("loading-model");
  const [backendProbe, setBackendProbe] = useState<BackendProbe>();
  const [downloadingModel, setDownloadingModel] = useState(false);
  const [modelProgress, setModelProgress] = useState<ModelProgress>({
    loadedBytes: 0,
    totalBytes: 0,
  });
  const [hud, setHud] = useState<HudModel>();
  const [scan, setScan] = useState<ScanResult>();
  const [error, setError] = useState<DetectionErrorCode>();
  // The per-frame debug snapshot updates on every result, but nothing renders
  // it by default (the debug overlay is hidden), so it lives in a ref read via
  // getDebugSnapshot() instead of state that would re-render every consumer per
  // frame.
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

  // Mirror the probe's graph-capture flag into a ref so the crash sentinel
  // heartbeat effect below can key on [status] alone. Keying it on
  // backendProbe too would tear the effect down and restart it every time a
  // recycled worker re-reports it, resetting startedAt and the frames baseline
  // mid-session and destroying the uptime the sentinel exists to collect. The
  // heartbeat reads this ref inside its interval instead.
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
  // Running total of detections results received this page load, incremented
  // in the "detections" handler body (never a setState updater, which
  // StrictMode double-invokes). The heartbeat effect below reads this against
  // a baseline captured when it starts, so framesProcessed in the sentinel
  // record counts only frames from the current running span.
  const framesTotalRef = useRef(0);
  // Capture duration of the most recently posted frame and the timestamp it was
  // posted, paired with the next detections result for the debug snapshot.
  const lastCaptureMsRef = useRef(0);
  const postTimeRef = useRef(0);
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
      const zoom: ZoomLevel = zoomModeRef.current === "2x" ? ZOOM_2X : ZOOM_OFF;
      // Recorded before the transfer detaches the bitmap.
      lastFrameInfoRef.current = {
        zoom,
        width: frame.width,
        height: frame.height,
      };
      worker.postMessage(
        {
          type: "detect",
          frame,
          includeCrop: detectionImageRef.current,
          zoom,
          confidenceThreshold: confidenceThresholdRef.current,
        },
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
   * PACING_REST_RATIO of the last round trip. The interval between captures is
   * therefore max(MIN_FRAME_INTERVAL_MS, 2x round trip). On fast devices the
   * absolute floor dominates, idling the GPU between frames instead of running
   * back-to-back; on slower devices the rest takes over, so the idle time
   * grows with how long inference takes and a phone that has started thermal
   * throttling automatically gets a longer break.
   */
  const schedulePacedFrame = useCallback((elapsedSincePostMs: number) => {
    const floorDelay = Math.max(0, MIN_FRAME_INTERVAL_MS - elapsedSincePostMs);
    const restDelay = PACING_REST_RATIO * elapsedSincePostMs;
    // Unthrottled (debug-only escape hatch): re-prime immediately, no floor.
    const delay = throttledRef.current ? Math.max(floorDelay, restDelay) : 0;
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
        worker.postMessage({ type: "load", model: activeModel });
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
          telemetry.modelLoadStart(message.fromCache);
          break;
        }
        case "model-downloaded": {
          telemetry.modelDownloaded(message.durationMs);
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
          telemetry.modelReady();
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
          const result = processDetectionResult({
            detections: message.detections,
            crop: message.crop,
            confidenceThreshold: confidenceThresholdRef.current,
            updateTracks: (detections) =>
              trackerRef.current?.update(detections) ?? [],
            includeContact: detectionImageRef.current,
            at: performance.now(),
          });
          setHud(result.hud);
          const frameInfo = lastFrameInfoRef.current;
          // Publish this scan's own detections for the detection view. Raw
          // per-frame output, not the coasted `tracked` set, since the view
          // exists to show what the model saw on each frame, not a coasted
          // track. Skipped when no frame info was recorded, which only
          // happens for a result that no capture preceded, since mapping
          // boxes needs the frame's geometry.
          if (frameInfo) {
            setScan({
              detections: result.detections,
              frame: { width: frameInfo.width, height: frameInfo.height },
              zoom: frameInfo.zoom,
              at: performance.now(),
            });
          }
          if (result.contact) {
            replaceContact(result.contact);
          }
          result.discardedCrop?.close();
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
            filteredCount: result.detections.length,
            shownCount: result.tracked.length,
            zoom: frameInfo?.zoom ?? ZOOM_OFF,
            // Carried forward for one line; schedulePacedFrame below writes
            // this frame's actual pacing decision.
            pacingDelayMs: debugRef.current.pacingDelayMs,
            pacingRule: debugRef.current.pacingRule,
          };
          telemetry.result({ inferenceMs, roundTripMs });
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
          telemetry.error(message.code, message.detail);
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
      telemetry.error("WORKER_CRASHED");
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
      // Ask whether this device can run the detector at all, immediately and
      // separately from `load`. The load below waits on service-worker control
      // so the weights land in the runtime cache, but that wait must not delay
      // the verdict: a device without usable WebGPU has to reach the
      // unsupported screen before the app asks for the camera, and must never
      // download a model it cannot run. The worker stays silent when the probe
      // passes and reports the full probe with `load` instead.
      worker.postMessage({ type: "probe" });
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
    activeModel,
    createWorker,
    replaceContact,
    schedulePacedFrame,
    sendFrame,
    telemetry,
  ]);

  const start = useCallback(
    (video: HTMLVideoElement) => {
      videoRef.current = video;
      if (runningRef.current) {
        return;
      }
      // A feed swapped in while the settings panel is open must honor the
      // pause: the panel's close effect starts the pump against videoRef.
      if (settingsOpenRef.current) {
        pausedBySettingsRef.current = true;
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

  // Bracket the pump's running window on the telemetry scanning clock. Keyed
  // on [status] alone, which is exactly the window: stop() takes "running"
  // back to "ready" for every pause the app has (settings open, page hidden),
  // so none of that dead time is counted as drive time.
  useEffect(() => {
    if (status !== "running") {
      return;
    }
    telemetry.scanningStarted();
    return () => {
      telemetry.scanningStopped();
    };
  }, [status, telemetry]);

  // Report how long this drive actually scanned, when it goes away. Both
  // listeners fire the same report, because neither alone covers the ways a
  // drive ends: `pagehide` catches a navigation or reload, and a page going
  // hidden catches the far more common one, the phone backgrounded or locked
  // at the end of a trip. The telemetry sink drains its clock per report, so
  // the two never double-count one drive.
  useEffect(() => {
    const reportScanSession = () => {
      telemetry.reportScanSession();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        reportScanSession();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", reportScanSession);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", reportScanSession);
    };
  }, [telemetry]);

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
  // running session: graphCapture is read from a ref inside the interval
  // instead of being a dep, because a periodic worker recycle re-posts
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
        graphCapture: graphCaptureRef.current,
        // Stamp the writing build, so a crash report names the deploy that
        // produced it rather than the one that happens to read the record.
        release: APP_RELEASE,
      });
    };
    // A reload or navigation away mid-scan unloads the page without ever
    // running this effect's cleanup (React does not flush cleanups during
    // unload), which would orphan the record and make the next launch read a
    // plain reload as a crash. pagehide is the last synchronous chance to
    // clear it, and a real crash never fires pagehide, so genuine kills still
    // leave the record behind. If the page returns from the bfcache instead of
    // unloading, the still-running interval rewrites the record on its next
    // tick, restoring coverage.
    const handlePageHide = () => {
      clearSentinel();
    };
    window.addEventListener("pagehide", handlePageHide);
    beat();
    // Self-rescheduling rather than a fixed interval, because the cadence is
    // not fixed: heartbeatDelayMs beats every second through the startup window
    // and every five after it. That buys one-second resolution on the uptime a
    // crash reports exactly where the crashes are, without adding a single
    // write to the hours of steady scanning that follow.
    let beatTimerId = 0;
    const scheduleBeat = () => {
      beatTimerId = window.setTimeout(
        () => {
          beat();
          scheduleBeat();
        },
        heartbeatDelayMs(Date.now() - startedAt),
      );
    };
    scheduleBeat();
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      window.clearTimeout(beatTimerId);
      clearSentinel();
    };
  }, [status]);

  const getDebugSnapshot = useCallback(() => debugRef.current, []);

  // The detection-image setting decides whether there is a contact card at all,
  // so the gate lives here rather than in the consumer: turning it off drops
  // the card already on screen the same instant it stops the worker from
  // cutting new ones, and every consumer sees one answer.
  const shownContact = detectionImage ? contact : undefined;

  const value = useMemo(
    () => ({
      status,
      backendProbe,
      downloadingModel,
      modelProgress,
      hud,
      scan,
      getDebugSnapshot,
      error,
      contact: shownContact,
      activeModel,
      start,
      stop,
    }),
    [
      status,
      backendProbe,
      downloadingModel,
      modelProgress,
      hud,
      scan,
      getDebugSnapshot,
      error,
      shownContact,
      activeModel,
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
