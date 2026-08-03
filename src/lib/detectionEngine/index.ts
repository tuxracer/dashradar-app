import { APP_RELEASE } from "@/lib/appRelease";
import { waitForNextVideoFrame } from "@/lib/camera";
import {
  clearSentinel,
  heartbeatDelayMs,
  writeHeartbeat,
} from "@/lib/crashSentinel";
import { CONFIDENCE_THRESHOLD } from "@/lib/detection";
import type { DetectionModel } from "@/lib/detectionModels";
import type { DetectionTelemetry } from "@/lib/detectionTelemetry";
import { createDetectionTracker } from "@/lib/detectionTracker";
import type { Contact } from "@/lib/processDetectionResult";
import { processDetectionResult } from "@/lib/processDetectionResult";
import { waitForServiceWorkerControl } from "@/lib/serviceWorker";
import { ZOOM_OFF } from "@/workers/detection/consts";
import type { ZoomLevel } from "@/workers/detection/types";
import { isWorkerResponse } from "@/workers/detection/types";
import {
  FRAME_RETRY_MS,
  INITIAL_DEBUG,
  INITIAL_SNAPSHOT,
  MIN_FRAME_INTERVAL_MS,
  PACING_REST_RATIO,
  SW_CONTROL_TIMEOUT_MS,
  WORKER_RECYCLE_AFTER_MS,
} from "./consts";
import type {
  DebugSnapshot,
  DetectionEngine,
  DetectionSnapshot,
  DetectionStatus,
  DetectionWorkerLike,
  EngineInputs,
  EngineSettings,
  ModelProgress,
} from "./types";

export * from "./consts";
export * from "./types";

/**
 * Build the detection engine: the worker lifecycle and frame-pump state
 * machine, with no React anywhere in it. One engine spans one page load of
 * scanning; `activate` spawns the worker and `deactivate` releases it, so the
 * owner can treat the pair like mount and unmount.
 *
 * Whether the pump runs is derived, never commanded: it runs exactly while
 * the inputs say a video is attached, the page is visible, and settings are
 * closed. Every transition of that derivation (and only those transitions)
 * starts or stops the pump, so there is no pause/resume protocol to hold
 * correctly at call sites.
 *
 * The race invariants inside are hard-won fixes ported verbatim from the
 * React provider this was extracted from: one frame in flight (`inFlight`), a
 * generation counter invalidating captures from before a stop, and a
 * `workerLoaded` gate so a recycle's still-loading worker is never handed a
 * frame it would silently drop. Understand what each protects before touching
 * them.
 */
export const createDetectionEngine = ({
  model,
  createWorker,
  telemetry,
}: {
  model: DetectionModel;
  createWorker: () => DetectionWorkerLike;
  telemetry: DetectionTelemetry;
}): DetectionEngine => {
  // ---- published state ----
  let snapshot: DetectionSnapshot = INITIAL_SNAPSHOT;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) {
      listener();
    }
  };
  const publish = (patch: Partial<DetectionSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    notify();
  };

  // ---- world state pushed in by the owner ----
  let inputs: EngineInputs = {
    video: undefined,
    visible: true,
    settingsOpen: false,
  };
  let settings: EngineSettings = {
    includeContact: false,
    throttled: true,
    zoom: ZOOM_OFF,
    confidenceThreshold: CONFIDENCE_THRESHOLD,
  };

  // ---- pump state ----
  // Bumped per activation so a pending model-load continuation from a
  // deactivated span can never post onto a later worker.
  let activation = 0;
  let active = false;
  // The derived running state's current value; compared against the fresh
  // derivation on every input change to find the edges.
  let running = false;
  let worker: DetectionWorkerLike | undefined;
  // performance.now() at the moment the current worker was created, so the
  // detections handler can recycle it once WORKER_RECYCLE_AFTER_MS has
  // elapsed (monotonic within a page load, which is the only comparison made).
  let workerCreatedAt = 0;
  // False from spawn until the worker reports `ready`, then false again on
  // error. The pump bails while it is false so a detect frame is never posted
  // to a worker whose model has not loaded (the worker silently drops it,
  // which would strand the in-flight count and deadlock the pump). A recycle
  // leaves status "running" with a fresh, still-loading worker, so the load
  // state is explicit rather than inferred from status.
  let workerLoaded = false;
  // Count of detect frames posted whose results have not come back. The pump
  // bails while it is nonzero, so a stale result from before a stop/start
  // re-primes the pipeline at depth 1 instead of stacking a second frame.
  let inFlight = 0;
  // Bumped whenever the pump stops so an in-flight capture from a previous
  // run discards its frame instead of posting it. A bare `running` re-check
  // after the await is not enough: a fast stop-then-start flips it back to
  // true while the stale capture is still pending.
  let generation = 0;
  let retryTimer: number | undefined;
  let paceTimer: number | undefined;
  // Crop factor and dimensions of the most recently posted frame. Only one
  // frame is ever in flight, so when a result arrives this always describes
  // the frame it came from.
  let lastFrameInfo:
    | { zoom: ZoomLevel; width: number; height: number }
    | undefined;
  let lastCaptureMs = 0;
  let postTime = 0;
  // Coasting tracker: shows each detection immediately and holds a stale box
  // for a few frames when the model briefly loses it. Recreated on every
  // pump stop, so a resumed session re-earns confirmation from scratch.
  let tracker = createDetectionTracker();
  const fileProgress = new Map<string, ModelProgress>();
  // Running total of detections results this engine processed; the crash
  // sentinel reads it against a baseline captured when scanning starts.
  let framesTotal = 0;
  let debug: DebugSnapshot = INITIAL_DEBUG;

  const clearTimers = () => {
    window.clearTimeout(retryTimer);
    window.clearTimeout(paceTimer);
  };

  /** Swap in the next contact (or none), closing the previous crop bitmap. */
  const replaceContact = (next: Contact | undefined) => {
    snapshot.contact?.image.close();
    publish({ contact: next });
  };

  // ---- crash sentinel ----
  // While scanning, write a timestamped record to localStorage on a cadence
  // so the NEXT launch can tell whether this session ended cleanly. Every
  // clean exit clears it; only an OS-level kill mid-scan (no JS runs) leaves
  // the last heartbeat behind for the next launch to report.
  let sentinelTimer = 0;
  let sentinelPageHide: (() => void) | undefined;
  const sentinelStart = () => {
    const startedAt = Date.now();
    const baseline = framesTotal;
    const beat = () => {
      writeHeartbeat({
        startedAt,
        lastBeatAt: Date.now(),
        framesProcessed: framesTotal - baseline,
        graphCapture: snapshot.backendProbe?.graphCapture,
        // Stamp the writing build, so a crash report names the deploy that
        // produced it rather than the one that happens to read the record.
        release: APP_RELEASE,
      });
    };
    // A reload or navigation away mid-scan can outrun any teardown path, so
    // pagehide is the last synchronous chance to clear the record; a real
    // crash never fires pagehide, so genuine kills still leave it behind. A
    // bfcache return leaves the still-running timer to rewrite the record on
    // its next tick, restoring coverage.
    sentinelPageHide = () => {
      clearSentinel();
    };
    window.addEventListener("pagehide", sentinelPageHide);
    beat();
    // Self-rescheduling rather than a fixed interval, because the cadence is
    // not fixed: heartbeatDelayMs beats every second through the startup
    // window and every five after it, buying one-second resolution on where
    // in startup a crash landed without extra writes to hours of scanning.
    const scheduleBeat = () => {
      sentinelTimer = window.setTimeout(
        () => {
          beat();
          scheduleBeat();
        },
        heartbeatDelayMs(Date.now() - startedAt),
      );
    };
    scheduleBeat();
  };
  const sentinelStop = () => {
    if (sentinelPageHide) {
      window.removeEventListener("pagehide", sentinelPageHide);
      sentinelPageHide = undefined;
    }
    window.clearTimeout(sentinelTimer);
    clearSentinel();
  };

  /**
   * The one place status changes, so the scanning-window side effects (the
   * telemetry clock and the crash sentinel) can never miss a transition.
   */
  const setStatus = (next: DetectionStatus) => {
    const previous = snapshot.status;
    if (next === previous) {
      return;
    }
    publish({ status: next });
    if (next === "running") {
      telemetry.scanningStarted();
      sentinelStart();
    } else if (previous === "running") {
      telemetry.scanningStopped();
      sentinelStop();
    }
  };

  const sendFrame = async () => {
    const video = inputs.video;
    if (!running || !video || !worker) {
      return;
    }
    if (!workerLoaded) {
      // A recycle (or the initial load) left a worker that has not reported
      // `ready` yet; it would silently drop this frame and strand the
      // in-flight count, deadlocking the pump. Its `ready` re-primes.
      return;
    }
    if (inFlight > 0) {
      // A frame is already at the worker; its result will re-prime the pump.
      return;
    }
    const capturedGeneration = generation;
    try {
      // Hold the capture until the camera presents a new frame, so inference
      // never runs twice on the same frame when detection outpaces the
      // camera. The wait can outlive the pump (rVFC does not fire while
      // hidden), so re-check the guards before committing to a capture.
      await waitForNextVideoFrame(video);
      if (capturedGeneration !== generation || !running || inFlight > 0) {
        return;
      }
      const captureStart = performance.now();
      const frame = await createImageBitmap(video);
      if (capturedGeneration !== generation || !running || inFlight > 0) {
        // The pump was stopped (and possibly restarted) while this capture
        // was pending; the restarted pump owns the in-flight slot now.
        frame.close();
        return;
      }
      lastCaptureMs = performance.now() - captureStart;
      postTime = performance.now();
      inFlight += 1;
      const zoom = settings.zoom;
      // Recorded before the transfer detaches the bitmap.
      lastFrameInfo = { zoom, width: frame.width, height: frame.height };
      worker.postMessage(
        {
          type: "detect",
          frame,
          includeCrop: settings.includeContact,
          zoom,
          confidenceThreshold: settings.confidenceThreshold,
        },
        [frame],
      );
    } catch {
      if (capturedGeneration !== generation || !running) {
        return;
      }
      // Video has no frame data yet (still attaching): retry shortly.
      retryTimer = window.setTimeout(() => {
        void sendFrame();
      }, FRAME_RETRY_MS);
    }
  };

  /**
   * Re-prime the pump after a result, delaying so captures never start less
   * than MIN_FRAME_INTERVAL_MS apart and the pump always rests at least
   * PACING_REST_RATIO of the last round trip: the interval between captures
   * is max(MIN_FRAME_INTERVAL_MS, 2x round trip). On fast devices the floor
   * dominates; on slower ones the rest takes over, so a phone that has
   * started thermal throttling automatically gets a longer break.
   */
  const schedulePacedFrame = (elapsedSincePostMs: number) => {
    const floorDelay = Math.max(0, MIN_FRAME_INTERVAL_MS - elapsedSincePostMs);
    const restDelay = PACING_REST_RATIO * elapsedSincePostMs;
    // Unthrottled (debug-only escape hatch): re-prime immediately, no floor.
    const delay = settings.throttled ? Math.max(floorDelay, restDelay) : 0;
    // Record the decision for the debug overlay's pacing row. The result
    // handler has already written this frame's snapshot, so merge onto it.
    debug = {
      ...debug,
      pacingDelayMs: delay,
      pacingRule: floorDelay >= restDelay ? "floor" : "rest",
    };
    paceTimer = window.setTimeout(() => {
      void sendFrame();
    }, delay);
  };

  /**
   * Defer the model download until a service worker controls the page so its
   * fetch flows through Workbox's runtime cache on a first visit (dev has no
   * service worker, so load immediately). The activation stamp discards the
   * continuation if the engine deactivated, or recycled to a newer worker,
   * while the wait was pending.
   */
  const requestLoad = (target: DetectionWorkerLike) => {
    const requestedIn = activation;
    const startLoad = import.meta.env.PROD
      ? waitForServiceWorkerControl(SW_CONTROL_TIMEOUT_MS)
      : Promise.resolve();
    void startLoad.then(() => {
      if (requestedIn !== activation || target !== worker) {
        return;
      }
      target.postMessage({ type: "load", model });
    });
  };

  const haltOnError = () => {
    running = false;
    workerLoaded = false;
    generation += 1;
    inFlight = 0;
    clearTimers();
    replaceContact(undefined);
  };

  const handleMessage = (event: MessageEvent) => {
    const message: unknown = event.data;
    if (!isWorkerResponse(message)) {
      return;
    }
    switch (message.type) {
      case "model-load-start": {
        publish({ downloadingModel: !message.fromCache });
        telemetry.modelLoadStart(message.fromCache);
        break;
      }
      case "model-downloaded": {
        telemetry.modelDownloaded(message.durationMs);
        break;
      }
      case "model-progress": {
        fileProgress.set(message.progress.file, {
          loadedBytes: message.progress.loaded,
          totalBytes: message.progress.total,
        });
        let loadedBytes = 0;
        let totalBytes = 0;
        for (const file of fileProgress.values()) {
          loadedBytes += file.loadedBytes;
          totalBytes += file.totalBytes;
        }
        publish({ modelProgress: { loadedBytes, totalBytes } });
        break;
      }
      case "backend-probe": {
        publish({ backendProbe: message.probe });
        break;
      }
      case "ready": {
        // Mark the worker loaded before priming the pump below, so the
        // sendFrame() call in the running branch is not itself bailed.
        workerLoaded = true;
        telemetry.modelReady();
        if (running) {
          setStatus("running");
          void sendFrame();
        } else {
          setStatus("ready");
        }
        break;
      }
      case "detections": {
        inFlight = Math.max(0, inFlight - 1);
        framesTotal += 1;
        const result = processDetectionResult({
          detections: message.detections,
          crop: message.crop,
          confidenceThreshold: settings.confidenceThreshold,
          updateTracks: (detections) => tracker.update(detections),
          includeContact: settings.includeContact,
          at: performance.now(),
        });
        const frameInfo = lastFrameInfo;
        const patch: Partial<DetectionSnapshot> = { hud: result.hud };
        // Publish this scan's own detections for the detection view. Raw
        // per-frame output, not the coasted set, since the view exists to
        // show what the model saw on each frame. Skipped when no frame info
        // was recorded (a result no capture preceded), since mapping boxes
        // needs the frame's geometry.
        if (frameInfo) {
          patch.scan = {
            detections: result.detections,
            frame: { width: frameInfo.width, height: frameInfo.height },
            zoom: frameInfo.zoom,
            at: performance.now(),
          };
        }
        if (result.contact) {
          snapshot.contact?.image.close();
          patch.contact = result.contact;
        }
        publish(patch);
        result.discardedCrop?.close();
        const { preprocessMs, inferenceMs, decodeMs } = message.timing;
        const roundTripMs = performance.now() - postTime;
        debug = {
          captureMs: lastCaptureMs,
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
          pacingDelayMs: debug.pacingDelayMs,
          pacingRule: debug.pacingRule,
        };
        telemetry.result({ inferenceMs, roundTripMs });
        // Recycle the worker once it has been running long enough, at this
        // result boundary where nothing is in flight, so no frame is lost.
        // Terminating and recreating the worker resets the native memory ORT
        // and the GPU stack leak across thousands of runs. Status stays
        // "running" throughout, so the new worker's `ready` re-primes the
        // pump; the recycle replaces schedulePacedFrame for this result.
        if (
          running &&
          performance.now() - workerCreatedAt >= WORKER_RECYCLE_AFTER_MS
        ) {
          worker?.terminate();
          // Invalidate any capture from the old pump so it can't post onto
          // the new worker, and drop the in-flight count for the restart.
          generation += 1;
          inFlight = 0;
          clearTimers();
          spawnWorker();
          if (worker) {
            requestLoad(worker);
          }
        } else {
          schedulePacedFrame(roundTripMs);
        }
        break;
      }
      case "worker-error": {
        telemetry.error(message.code, message.detail);
        publish({ error: message.code });
        setStatus("error");
        haltOnError();
        break;
      }
    }
  };

  const handleError = () => {
    telemetry.error("WORKER_CRASHED");
    publish({ error: "WORKER_CRASHED" });
    setStatus("error");
    haltOnError();
  };

  /**
   * Create a worker, wire its handlers, and record its birth time. Used by
   * activation and the periodic recycle. The probe is posted immediately and
   * separately from `load`: the load waits on service-worker control so the
   * weights land in the runtime cache, but that wait must not delay the
   * verdict, because a device without usable WebGPU has to reach the
   * unsupported screen before the camera ask and before any model bytes.
   */
  const spawnWorker = () => {
    const next = createWorker();
    worker = next;
    workerCreatedAt = performance.now();
    // Fresh worker: its model is not loaded until it reports `ready`.
    workerLoaded = false;
    next.onmessage = handleMessage;
    next.onerror = handleError;
    next.postMessage({ type: "probe" });
  };

  /** Whether the world the inputs describe wants the pump running. */
  const shouldRun = () =>
    inputs.video !== undefined && inputs.visible && !inputs.settingsOpen;

  /**
   * Re-derive the running state and act on its edges. A falling edge is the
   * old stop(): invalidate in-flight work, reset the tracker (a resumed
   * session must re-earn track confirmation), and step status back. A rising
   * edge is the old start(): prime the pump if the model is ready, or let the
   * `ready` handler prime it when the load lands.
   */
  const evaluate = () => {
    const desired = active && shouldRun();
    if (desired === running) {
      return;
    }
    if (desired) {
      running = true;
      if (snapshot.status === "ready") {
        setStatus("running");
        void sendFrame();
      }
      return;
    }
    running = false;
    generation += 1;
    clearTimers();
    tracker = createDetectionTracker();
    if (snapshot.status === "running") {
      setStatus("ready");
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    setInputs: (next) => {
      inputs = { ...inputs, ...next };
      evaluate();
    },
    updateSettings: (next) => {
      settings = next;
    },
    getDebugSnapshot: () => debug,
    activate: () => {
      if (active) {
        return;
      }
      active = true;
      activation += 1;
      // A fresh activation behaves like a fresh mount: published state and
      // per-load counters reset before the new worker reports anything.
      snapshot.contact?.image.close();
      snapshot = INITIAL_SNAPSHOT;
      notify();
      fileProgress.clear();
      debug = INITIAL_DEBUG;
      inFlight = 0;
      generation += 1;
      tracker = createDetectionTracker();
      spawnWorker();
      if (worker) {
        requestLoad(worker);
      }
      evaluate();
    },
    deactivate: () => {
      if (!active) {
        return;
      }
      active = false;
      activation += 1;
      evaluate();
      clearTimers();
      replaceContact(undefined);
      // Terminate whichever worker is current, which is the recycled one if
      // a recycle has happened, not the one spawned at activation.
      worker?.terminate();
      worker = undefined;
      workerLoaded = false;
      inFlight = 0;
      generation += 1;
    },
  };
};
