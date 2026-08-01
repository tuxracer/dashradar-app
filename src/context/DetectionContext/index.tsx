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
import { useDevVideo } from "@/context/DevVideoContext";
import { useSettings } from "@/context/SettingsContext";
import { APP_RELEASE } from "@/lib/appRelease";
import { waitForNextVideoFrame } from "@/lib/camera";
import {
  clearSentinel,
  heartbeatDelayMs,
  writeHeartbeat,
} from "@/lib/crashSentinel";
import { initialAutoZoomState, stepAutoZoom } from "@/lib/autoZoom";
import type { AutoZoomLevel, AutoZoomState } from "@/lib/autoZoom";
import type { HudModel } from "@/lib/detection";
import { buildHudModel, toRoadDetections } from "@/lib/detection";
import { createDetectionTracker } from "@/lib/detectionTracker";
import { contactDirection, signalFromScore } from "@/lib/radarSignal";
import { downloadBlob, frameFilename } from "@/lib/saveFrame";
import { waitForServiceWorkerControl } from "@/lib/serviceWorker";
import {
  recordTimings,
  takeTimingReport,
  toBucketedSeconds,
} from "@/lib/timingHistory";
import {
  MODEL_REVISION,
  MODEL_SLUG,
  POLICE_LABEL,
  ZOOM_2X,
  ZOOM_OFF,
} from "@/workers/detection/consts";
import type {
  BackendProbe,
  DetectionErrorCode,
} from "@/workers/detection/types";
import { isWorkerResponse } from "@/workers/detection/types";
import {
  DARK_BRIGHT_FRACTION,
  ERROR_DETAIL_MAX_LENGTH,
  FRAME_RETRY_MS,
  INITIAL_DEBUG,
  MAX_RECONNECT_ATTEMPTS,
  MIN_FRAME_INTERVAL_MS,
  OBSCURED_FRAME_THRESHOLD,
  PACING_REST_RATIO,
  POLICE_EVENT_DEBOUNCE_MS,
  RECOVERY_HEALTHY_FRAMES,
  STALE_FRAME_THRESHOLD,
  SW_CONTROL_TIMEOUT_MS,
  WATCHDOG_MS,
  WATCHDOG_ROUND_TRIP_MULTIPLE,
  WORKER_RECYCLE_AFTER_MS,
} from "./consts";
import type {
  CameraStallReason,
  Contact,
  DebugSnapshot,
  DetectionContextValue,
  DetectionStatus,
  DetectionWorkerLike,
  ModelProgress,
  SavedFrame,
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
  /**
   * Overrides whether the feed is a video file rather than the camera. A
   * file-backed feed legitimately pauses and repeats frames, so the
   * camera-stall machinery (watchdog, frozen and obscured detectors, recovery)
   * is disabled while one is playing. This is a test seam; production leaves
   * it undefined and derives the answer from DevVideoContext, which can change
   * mid-session when a file is dropped.
   */
  devVideoMode?: boolean;
};

export const DetectionProvider = ({
  children,
  createWorker = createDetectionWorker,
  devVideoMode,
}: DetectionProviderProps) => {
  const {
    frameThumbnails,
    saveFrames,
    autoSaveFrames,
    detectionImage,
    throttleInference,
    zoomMode,
    confidenceThreshold,
    settingsOpen,
  } = useSettings();
  const {
    source: devVideoSource,
    setVideoFile,
    clearVideoFile,
  } = useDevVideo();
  const devVideoActive = devVideoMode ?? devVideoSource !== null;
  // Ref-mirrored rather than read directly: devVideoMode used to be a
  // dependency of the worker lifecycle effect below, so making it reactive
  // would terminate and respawn the worker (recompiling the model) on every
  // feed swap. Same pattern as includeFrameRef below.
  const devVideoModeRef = useRef(devVideoActive);
  useEffect(() => {
    devVideoModeRef.current = devVideoActive;
  }, [devVideoActive]);
  // Mirrors the frame-saving flags for sendFrame, which is a stable callback:
  // the pump reads the current value per capture instead of re-subscribing on
  // toggles. It asks the worker for the model-input JPEG the contact card's
  // SAVE button downloads. Auto save needs the same JPEG, so it implies the
  // request rather than making the two settings order-dependent.
  const includeFrameRef = useRef(saveFrames || autoSaveFrames);
  useEffect(() => {
    includeFrameRef.current = saveFrames || autoSaveFrames;
  }, [saveFrames, autoSaveFrames]);
  // Mirrors auto save for the detections handler, which downloads a detection's
  // frame the moment it arrives.
  const autoSaveRef = useRef(autoSaveFrames);
  useEffect(() => {
    autoSaveRef.current = autoSaveFrames;
  }, [autoSaveFrames]);
  // Mirrors the frame-preview flag the same way. It asks the worker for a
  // thumbnail of what the model saw on scans with no detection to crop. The
  // preview extends the contact card to every scan, so it rides on the card
  // being shown at all: with the detection image off there is nothing to
  // extend, and asking for the thumbnail would only burn a bitmap per scan.
  const includeThumbnailRef = useRef(frameThumbnails && detectionImage);
  useEffect(() => {
    includeThumbnailRef.current = frameThumbnails && detectionImage;
  }, [frameThumbnails, detectionImage]);
  // Mirrors the detection-image setting for the detections handler, which shows
  // the contact card only while it is on.
  const detectionImageRef = useRef(detectionImage);
  useEffect(() => {
    detectionImageRef.current = detectionImage;
  }, [detectionImage]);
  // Asks the worker for the cutout of the top detection. The card needs it, and
  // so does auto save, which uses the cutout's validated detection as the
  // signal that a scan is worth downloading; requesting it for either keeps the
  // two settings independent, the same way includeFrame serves both frame
  // saving and auto save.
  const includeCropRef = useRef(detectionImage || autoSaveFrames);
  useEffect(() => {
    includeCropRef.current = detectionImage || autoSaveFrames;
  }, [detectionImage, autoSaveFrames]);
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
  // Auto zoom machine state: the crop factor the next auto-mode scan captures
  // at, advanced by the detections handler from each scan's outcome (see
  // src/lib/autoZoom). A ref, not state: it changes per result and nothing
  // renders it directly.
  const autoZoomRef = useRef(initialAutoZoomState());
  // The machine's current state (level and lock), mirrored into React state
  // for the ZoomIndicator chip. Updates once per scan at most (the same
  // cadence as setHud), so the ref/state split costs nothing extra here; the
  // ref stays the source the pump reads synchronously.
  const [autoZoom, setAutoZoom] = useState<AutoZoomState>(
    initialAutoZoomState(),
  );
  useEffect(() => {
    zoomModeRef.current = zoomMode;
    // A mode change invalidates any lock or alternation phase, so auto always
    // begins a fresh spell zoomed out. The autoZoom state needs no reset
    // here: the mode is only changeable from the settings panel, and opening
    // the panel already stopped the pump, which resets the level with the
    // machine.
    autoZoomRef.current = initialAutoZoomState();
  }, [zoomMode]);
  // Crop factor and dimensions of the most recently posted frame. Only one
  // frame is ever in flight, so when a detections result arrives this always
  // describes the frame it came from; the auto zoom step needs the capture
  // zoom (was this a 1x or 2x look?) and the frame geometry for its fit check.
  const lastFrameInfoRef = useRef<
    { zoom: AutoZoomLevel; width: number; height: number } | undefined
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
  const [error, setError] = useState<DetectionErrorCode>();
  // The per-frame debug snapshot updates on every result, but nothing renders
  // it by default (the debug overlay is hidden), so it lives in a ref read via
  // getDebugSnapshot() instead of state that would re-render every consumer per
  // frame.
  const debugRef = useRef<DebugSnapshot>(INITIAL_DEBUG);
  const [contact, setContact] = useState<Contact>();
  // Latest auto-saved frame, published for the save toast. Only auto save
  // writes it: the contact card's SAVE button is a deliberate tap, so it needs
  // no confirmation the way a download firing on its own does.
  const [savedFrame, setSavedFrame] = useState<SavedFrame>();
  // Mirrors `contact` so the previous bitmap can be closed from event
  // handlers without a side effect inside a setState updater (StrictMode
  // double-invokes updaters; see statusRef above).
  const contactRef = useRef<Contact | undefined>(undefined);
  // Terminal flag: automatic recovery gave up after MAX_RECONNECT_ATTEMPTS on a
  // frozen or black feed. App renders the CAMERA_STALLED alert; a reload (the
  // alert's button) is the only exit, so no ref mirror is needed.
  const [cameraStalled, setCameraStalled] = useState(false);
  // True while a camera recovery is in flight. Recovery is silent (nothing is
  // shown to the driver), so this is a ref, not state: it exists only for
  // beginRecovery's re-entrancy guard, which branches on it outside a setState
  // updater (StrictMode double-invokes those).
  const recoveringRef = useRef(false);
  // Bumped once per recovery; App keys <CameraView> on it, so incrementing it
  // remounts the camera element and re-runs getUserMedia.
  const [cameraEpoch, setCameraEpoch] = useState(0);
  // Fingerprint of the previous detection frame and the count of consecutive
  // byte-identical frames since. STALE_FRAME_THRESHOLD identical frames means
  // a frozen or black feed (a live feed always varies), triggering recovery.
  const lastFingerprintRef = useRef<number | undefined>(undefined);
  const staleFrameCountRef = useRef(0);
  // Count of consecutive dark inference frames (brightFraction below
  // DARK_BRIGHT_FRACTION). OBSCURED_FRAME_THRESHOLD of them means a physically
  // obscured lens: a noisy near-black feed the byte-identical fingerprint check
  // above cannot catch, because sensor noise perturbs every frame.
  const darkFrameCountRef = useRef(0);
  // Consecutive changing frames since the last stall; RECOVERY_HEALTHY_FRAMES
  // of them prove a recovery worked and reset the reconnect-attempt counter.
  const healthyFrameCountRef = useRef(0);
  // Consecutive recoveries that re-stalled before proving healthy. At
  // MAX_RECONNECT_ATTEMPTS the next stall reloads the page instead of
  // remounting.
  const reconnectAttemptsRef = useRef(0);
  // Pending watchdog timeout (Task 3): fires when no result arrives in time.
  const watchdogTimerRef = useRef<number | undefined>(undefined);
  // Holds the latest beginRecovery so the message handler and watchdog
  // (defined inside the worker effect, before beginRecovery's declaration)
  // can call it, mirroring the sendFrameRef idiom already used for sendFrame.
  // The argument tags which detector tripped, for the camera_stall analytics.
  const beginRecoveryRef = useRef<(reason: CameraStallReason) => void>(
    () => {},
  );
  // Holds the latest armWatchdog (a closure inside the worker effect) so start()
  // can arm the watchdog when it primes the pump, not only the ready/detections
  // handlers inside the effect. Mirrors the beginRecoveryRef idiom.
  const armWatchdogRef = useRef<(lastRoundTripMs?: number) => void>(() => {});

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
  // Guards the one-time ready analytics (model_ready) so a recycled worker's
  // `ready` does not re-fire it, which would otherwise inflate the count every
  // WORKER_RECYCLE_AFTER_MS of a scanning session.
  const readyTrackedRef = useRef(false);
  // Guards the one-time model_downloaded analytics. A page load downloads the
  // weights at most once in practice (later loads read the runtime cache), but
  // a device whose cache never sticks would otherwise re-download and re-fire
  // the event on every periodic worker recycle.
  const modelDownloadTrackedRef = useRef(false);
  // Guards the one-time first_inference / first_round_trip analytics so only
  // the first result of the page load is counted, not every scan (which would
  // be one event every couple of seconds for the whole drive). One ref for
  // both, since they describe the same first scan and always fire together.
  const firstResultTrackedRef = useRef(false);
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
      // Fixed modes always post their level; auto posts whatever the machine
      // decided after the previous scan (1x on the first scan of a session).
      const zoom: AutoZoomLevel =
        zoomModeRef.current === "2x"
          ? ZOOM_2X
          : zoomModeRef.current === "auto"
            ? autoZoomRef.current.zoom
            : ZOOM_OFF;
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
          includeFrame: includeFrameRef.current,
          includeThumbnail: includeThumbnailRef.current,
          includeCrop: includeCropRef.current,
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
        worker.postMessage({ type: "load" });
      });
    };

    /**
     * (Re)start the stalled-feed watchdog. Armed on ready and on every result
     * while the pump is live; if it lapses (rVFC stopped firing, so no result
     * came back) it recovers the camera. Gated on runningRef + workerLoadedRef
     * so it never fires during a paused pump or the recycle load window.
     *
     * The window scales with the round trip that preceded it, floored at
     * WATCHDOG_MS, so a device slow enough to space its results wider than the
     * floor is not permanently past its own deadline. Arming before a session
     * has produced a result has no round trip to scale from and uses the floor.
     */
    const armWatchdog = (lastRoundTripMs = 0) => {
      // Clearing precedes the file-feed bail so a camera-to-clip swap can never
      // leave the previous timer running. stop() clears it on every source
      // change today, and beginRecovery vetoes a stray firing, but this way the
      // helper is correct on its own rather than by arrangement.
      window.clearTimeout(watchdogTimerRef.current);
      // A paused video file produces no results for as long as the user
      // likes; never arm the stall watchdog against a file-backed feed.
      if (devVideoModeRef.current) {
        return;
      }
      const timeoutMs = Math.max(
        WATCHDOG_MS,
        WATCHDOG_ROUND_TRIP_MULTIPLE * lastRoundTripMs,
      );
      watchdogTimerRef.current = window.setTimeout(() => {
        if (runningRef.current && workerLoadedRef.current) {
          beginRecoveryRef.current("watchdog");
        }
      }, timeoutMs);
    };
    armWatchdogRef.current = armWatchdog;

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
        case "model-downloaded": {
          // Which model actually reached this device, and how long the bytes
          // took to arrive. The revision is the only thing that says which
          // weights a session ran, so a bad rollout is visible in analytics
          // without waiting for it to surface as an error.
          if (!modelDownloadTrackedRef.current) {
            modelDownloadTrackedRef.current = true;
            track("model_downloaded", {
              model: MODEL_SLUG,
              revision: MODEL_REVISION,
              seconds: Math.round(message.durationMs / 1_000),
            });
          }
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
          // Report how the weights loaded. With no backend there is no other
          // view into how often the runtime cache is actually hit, which is
          // the difference between a first-visit download and an instant
          // start. Emitted from the message handler body, not a setState
          // updater, so StrictMode's double-invoke of updaters can't
          // double-count it. Gated to the first ready of the page load: a
          // periodic worker recycle produces a fresh `ready` every
          // WORKER_RECYCLE_AFTER_MS, which must not re-fire the event.
          if (!readyTrackedRef.current) {
            readyTrackedRef.current = true;
            track("model_ready", { fromCache: modelFromCacheRef.current });
          }
          if (runningRef.current) {
            statusRef.current = "running";
            setStatus("running");
            armWatchdog();
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
          const roadDetections = toRoadDetections(
            message.detections,
            confidenceThresholdRef.current,
          );
          const tracked = trackerRef.current?.update(roadDetections) ?? [];
          setHud(buildHudModel(tracked));
          // Auto zoom: pick the next scan's crop factor from this scan's
          // outcome. Fed the coasted set, not the raw detections, so a
          // one-frame flicker cannot release a lock before the tracker drops
          // the object. In the fixed modes the machine is left at its reset
          // state; sendFrame ignores it there.
          const frameInfo = lastFrameInfoRef.current;
          if (zoomModeRef.current === "auto" && frameInfo) {
            autoZoomRef.current = stepAutoZoom({
              zoom: frameInfo.zoom,
              detections: tracked,
              frameWidth: frameInfo.width,
              frameHeight: frameInfo.height,
            });
            setAutoZoom(autoZoomRef.current);
          }
          // Pair the crop with its detection. Validation mirrors the road
          // filter; a crop whose detection is dropped is discarded so the
          // card never shows evidence the HUD pipeline would not count.
          if (message.crop) {
            const [cropDetection] = toRoadDetections(
              [message.detections[message.crop.detectionIndex]],
              confidenceThresholdRef.current,
            );
            if (cropDetection) {
              // With the detection image off the cutout is only here because
              // auto save asked for it, so close the bitmap and leave the card
              // alone; the download below still runs.
              if (detectionImageRef.current) {
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
              // Auto save (developer option) downloads the frame the instant a
              // detection lands, so training data can be collected on a drive
              // without reaching for the card's SAVE button. Deliberately
              // inside this branch: only scans that actually detected
              // something download, never the detection-free scans (which is
              // most of them), and never a crop whose detection failed the road
              // filter above. Sits in the handler body rather than a setState
              // updater, which StrictMode double-invokes.
              if (autoSaveRef.current && message.frame) {
                const filename = frameFilename(new Date());
                downloadBlob(message.frame, filename);
                // A download on a phone gives no visible sign it happened, so
                // publish the save for the toast. A fresh `at` each time is
                // what makes a run of saves re-show it rather than sitting
                // still after the first one.
                setSavedFrame({ filename, at: performance.now() });
              }
            } else {
              message.crop.image.close();
            }
          } else if (message.frameThumbnail) {
            // Frame preview on, no detection to crop: show a bare preview so the
            // card reflects every scan. No detection metadata, so the meter
            // stays at zero and the card's direction row stays hidden. The
            // gate covers a frame that was already in flight when the detection
            // image was turned off.
            if (detectionImageRef.current) {
              replaceContact({
                image: message.frameThumbnail,
                frame: message.frame,
                at: performance.now(),
              });
            } else {
              message.frameThumbnail.close();
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
            brightFraction: message.brightFraction ?? 0,
            zoom: frameInfo?.zoom ?? ZOOM_OFF,
            zoomLocked: autoZoomRef.current.locked,
            // Carried forward for one line; schedulePacedFrame below writes
            // this frame's actual pacing decision.
            pacingDelayMs: debugRef.current.pacingDelayMs,
            pacingRule: debugRef.current.pacingRule,
          };
          // The session actually got scanning: the intro was dismissed, camera
          // permission was granted, the stream started, the model loaded, and a
          // frame made it through inference. Every earlier gate has its own
          // drop-off, so this is the one event that says all of them were
          // cleared. The pair carries this first scan's inference time and
          // round trip on the same half-second grid the timing events use,
          // which are the cold numbers those medians never see: the first scan
          // pays the session compile and a cold GPU. Once per page load only,
          // since a per-frame event would fire every couple of seconds for the
          // length of a drive. Emitted from the handler body, not a setState
          // updater, which StrictMode double-invokes.
          if (!firstResultTrackedRef.current) {
            firstResultTrackedRef.current = true;
            track("first_inference", {
              seconds: toBucketedSeconds(inferenceMs),
            });
            track("first_round_trip", {
              seconds: toBucketedSeconds(roundTripMs),
            });
          }
          // Roll the same two numbers into the sessionStorage window, so a
          // drive's recent pacing can be read back off the device afterwards
          // without the debug overlay having been open at the time. Once the
          // window first fills, report its medians to analytics: five scans in
          // is past the first-run costs (session compile, a cold GPU) and is
          // early enough that even a short session reaches it, so the
          // fleet-wide numbers cover every drive. takeTimingReport is the
          // once-per-session guard, so this stays quiet for the rest of the
          // drive no matter how long it scans.
          const report = takeTimingReport(
            recordTimings({ roundTripMs, inferenceMs }),
          );
          if (report) {
            track("timing_round_trip", { seconds: report.roundTrip });
            track("timing_inference", { seconds: report.inference });
          }
          // Camera-health check. Only while the pump is live: a late in-flight
          // result arriving after stop() (e.g. mid-recovery) has runningRef
          // false and must not touch the detectors. A byte-identical
          // fingerprint means a frozen or black feed; a changing one is a
          // healthy frame and, after enough of them, proves a prior recovery
          // worked.
          if (runningRef.current) {
            armWatchdog(roundTripMs);
            // Stall detectors are meaningless against a file-backed feed: a
            // paused or scrubbed dev video repeats frames legitimately. Skip
            // the accounting entirely so a tripped threshold can never take
            // the break that skips the paced re-prime below.
            if (!devVideoModeRef.current) {
              const { fingerprint, brightFraction } = message;
              if (
                fingerprint !== undefined &&
                fingerprint === lastFingerprintRef.current
              ) {
                // Byte-identical frame: a frozen or camera-takeover stall, the
                // frozen detector's territory. Clearing the dark streak here is
                // what makes a solid-black frozen feed tag "frozen" rather than
                // "obscured": the obscured detector only ever counts changing
                // frames (its real signature, see the else branch), so a stall
                // whose frames repeat byte for byte can only ever be frozen.
                staleFrameCountRef.current += 1;
                healthyFrameCountRef.current = 0;
                darkFrameCountRef.current = 0;
              } else {
                // Changing frame. The obscured-lens detector looks only at these:
                // a covered lens presents a noisy near-black feed (sensor noise
                // changes every frame, so the frozen check never fires for it)
                // with no bright pixels anywhere. brightFraction below the dark
                // threshold for OBSCURED_FRAME_THRESHOLD consecutive changing
                // frames means the lens is blocked. A night scene keeps some
                // bright region, so it stays above and both streaks reset.
                staleFrameCountRef.current = 0;
                if (
                  brightFraction !== undefined &&
                  brightFraction < DARK_BRIGHT_FRACTION
                ) {
                  // A dark frame is not a healthy frame. Counting it as healthy
                  // would drive healthyFrameCountRef to RECOVERY_HEALTHY_FRAMES
                  // and zero reconnectAttemptsRef on the same frame the obscured
                  // detector fires, so reconnectAttemptsRef could never reach
                  // MAX_RECONNECT_ATTEMPTS and a covered lens would never escalate
                  // to the terminal CAMERA_STALLED alert.
                  darkFrameCountRef.current += 1;
                  healthyFrameCountRef.current = 0;
                } else {
                  darkFrameCountRef.current = 0;
                  healthyFrameCountRef.current += 1;
                  if (healthyFrameCountRef.current >= RECOVERY_HEALTHY_FRAMES) {
                    reconnectAttemptsRef.current = 0;
                  }
                }
              }
              lastFingerprintRef.current = fingerprint;
              if (staleFrameCountRef.current >= STALE_FRAME_THRESHOLD) {
                beginRecoveryRef.current("frozen");
                // Recovery owns the pump now (stop() ran); skip the re-prime
                // below.
                break;
              }
              if (darkFrameCountRef.current >= OBSCURED_FRAME_THRESHOLD) {
                beginRecoveryRef.current("obscured");
                // Recovery owns the pump now (stop() ran); skip the re-prime.
                break;
              }
            }
          }
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
            window.clearTimeout(watchdogTimerRef.current);
            const next = spawnWorker();
            requestLoad(next);
          } else {
            schedulePacedFrame(roundTripMs);
          }
          break;
        }
        case "worker-error": {
          // The cause rides along only for codes that carry one (the GPUDevice
          // lost reason today), truncated because a platform string is not
          // something to hand an analytics property unbounded.
          track("error", {
            code: message.code,
            ...(message.detail && {
              detail: message.detail.slice(0, ERROR_DETAIL_MAX_LENGTH),
            }),
          });
          setError(message.code);
          statusRef.current = "error";
          setStatus("error");
          runningRef.current = false;
          workerLoadedRef.current = false;
          pumpGenerationRef.current += 1;
          inFlightRef.current = 0;
          window.clearTimeout(retryTimerRef.current);
          window.clearTimeout(paceTimerRef.current);
          window.clearTimeout(watchdogTimerRef.current);
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
      window.clearTimeout(watchdogTimerRef.current);
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
      window.clearTimeout(watchdogTimerRef.current);
      replaceContact(undefined);
      // Terminate whichever worker is current, which is the recycled one if a
      // recycle has happened, not the one spawned at mount.
      workerRef.current?.terminate();
    };
  }, [createWorker, replaceContact, schedulePacedFrame, sendFrame]);

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
      // A fresh stream (initial or post-recovery) clears the recovery guard
      // and resets the frozen-feed detectors for a clean measurement window.
      // The reconnect-attempt counter is deliberately NOT reset here; only a
      // run of healthy frames (in the detections handler) proves a recovery
      // worked.
      recoveringRef.current = false;
      lastFingerprintRef.current = undefined;
      staleFrameCountRef.current = 0;
      darkFrameCountRef.current = 0;
      healthyFrameCountRef.current = 0;
      // Branch on statusRef outside the setStatus updater: StrictMode
      // double-invokes updater functions, so a side effect (the frame pump)
      // inside one would post two frames per start().
      if (statusRef.current === "ready") {
        statusRef.current = "running";
        setStatus("running");
        armWatchdogRef.current();
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
    window.clearTimeout(watchdogTimerRef.current);
    // Confirmation is wall-clock-age based, so a track left pending across a
    // long stop() would otherwise confirm on the first matched frame after
    // restart. A resumed session must re-earn confirmation from scratch.
    trackerRef.current = createDetectionTracker();
    // The auto zoom resets with the tracker: whatever it had locked onto is
    // gone with the tracks, so the next session starts zoomed out.
    autoZoomRef.current = initialAutoZoomState();
    setAutoZoom(initialAutoZoomState());
    if (statusRef.current === "running") {
      statusRef.current = "ready";
      setStatus("ready");
    }
  }, []);

  /**
   * Swaps the detection feed to `file`, or back to the startup source with
   * null. Stops the pump first, synchronously: child effects run before parent
   * effects, so a stop() scheduled after the state change would land after the
   * newly mounted view had already called start() and would kill the pump it
   * just started. stop() also resets the tracker and auto zoom, which is what
   * you want when frames start arriving from a different world.
   */
  const swapVideoSource = useCallback(
    (file: File | null) => {
      stop();
      if (file) {
        setVideoFile(file);
      } else {
        clearVideoFile();
      }
    },
    [stop, setVideoFile, clearVideoFile],
  );

  /**
   * Forgets a camera stall. Returning to the camera after a clip has played
   * deserves a fresh attempt rather than the terminal screen a previous stall
   * left behind, so the attempt counter resets with it.
   */
  const clearCameraStall = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    setCameraStalled(false);
  }, []);

  /**
   * Recover a dead camera feed in place, silently: nothing is shown to the
   * driver while it happens, since the meter's own pause is the only thing
   * worth their attention and an overlay would just take the glass away from
   * it. Stops the pump, resets the frozen-feed detectors, and remounts the
   * camera by bumping cameraEpoch (App keys CameraView on it). After
   * MAX_RECONNECT_ATTEMPTS consecutive
   * recoveries that never proved healthy, gives up and surfaces the
   * CAMERA_STALLED alert (via setCameraStalled) instead of another remount: a
   * feed still black after several remounts is likely an obscured or failed
   * lens that a silent page reload would only loop on, so the driver is asked
   * to clear the camera and reload manually. The re-entrancy guard means a
   * second trigger while already recovering is a no-op; the fresh stream's
   * start() clears it.
   */
  const beginRecovery = useCallback(
    (reason: CameraStallReason) => {
      // Defense in depth alongside the disabled detectors: recovery would
      // remount the player and lose the clip's playback position.
      if (devVideoModeRef.current || recoveringRef.current) {
        return;
      }
      recoveringRef.current = true;
      // Report every detected stall, past the re-entrancy guard so a burst of
      // triggers counts once, tagged with which detector tripped. This covers
      // both the transient stalls a remount fixes and the terminal give-up below
      // (which also fires the CAMERA_STALLED error), so the fleet-wide stall rate
      // and its cause are visible even when recovery succeeds silently.
      track("camera_stall", { reason });
      window.clearTimeout(watchdogTimerRef.current);
      lastFingerprintRef.current = undefined;
      staleFrameCountRef.current = 0;
      darkFrameCountRef.current = 0;
      healthyFrameCountRef.current = 0;
      stop();
      if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        // Automatic recovery is out of attempts; hand off to the driver. Track it
        // so the fleet-wide rate of unrecoverable camera stalls is visible (the
        // old silent reload left no signal).
        track("error", { code: "CAMERA_STALLED" });
        setCameraStalled(true);
        return;
      }
      reconnectAttemptsRef.current += 1;
      setCameraEpoch((epoch) => epoch + 1);
    },
    [stop],
  );
  useEffect(() => {
    beginRecoveryRef.current = beginRecovery;
  }, [beginRecovery]);

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
      getDebugSnapshot,
      error,
      contact: shownContact,
      savedFrame,
      autoZoom,
      cameraStalled,
      cameraEpoch,
      start,
      stop,
      swapVideoSource,
      clearCameraStall,
    }),
    [
      status,
      backendProbe,
      downloadingModel,
      modelProgress,
      hud,
      getDebugSnapshot,
      error,
      shownContact,
      savedFrame,
      autoZoom,
      cameraStalled,
      cameraEpoch,
      start,
      stop,
      swapVideoSource,
      clearCameraStall,
    ],
  );

  return (
    <DetectionContext.Provider value={value}>
      {children}
    </DetectionContext.Provider>
  );
};
