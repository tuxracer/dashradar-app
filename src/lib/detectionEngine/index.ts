import {
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  EMPTY,
  map,
  Observable,
  pairwise,
  repeat,
  skip,
  Subject,
  switchMap,
  takeUntil,
  tap,
} from "rxjs";
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
import { createWakeLockManager } from "@/lib/wakeLock";
import { ZOOM_OFF } from "@/workers/detection/consts";
import type { WorkerResponse, ZoomLevel } from "@/workers/detection/types";
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
  const snapshot$ = new BehaviorSubject<DetectionSnapshot>(INITIAL_SNAPSHOT);
  const publish = (patch: Partial<DetectionSnapshot>) => {
    snapshot$.next({ ...snapshot$.value, ...patch });
  };

  // ---- world state pushed in by the owner ----
  const inputs$ = new BehaviorSubject<EngineInputs>({
    video: undefined,
    visible: true,
    settingsOpen: false,
  });
  const settings$ = new BehaviorSubject<EngineSettings>({
    includeContact: false,
    throttled: true,
    zoom: ZOOM_OFF,
    confidenceThreshold: CONFIDENCE_THRESHOLD,
  });
  const active$ = new BehaviorSubject(false);

  /** Whether this world state wants the pump running. */
  const wantsToRun = (
    isActive: boolean,
    { video, visible, settingsOpen }: EngineInputs,
  ) => isActive && video !== undefined && visible && !settingsOpen;

  /**
   * The derived running state. Everything scoped to a running span hangs off
   * this stream, so a falling edge tears it all down by unsubscription.
   */
  const running$ = combineLatest([active$, inputs$]).pipe(
    map(([isActive, inputs]) => wantsToRun(isActive, inputs)),
    distinctUntilChanged(),
  );

  // ---- pump state ----
  // The derived running state's current value; compared against the fresh
  // derivation on every input change to find the edges.
  let running = false;
  // The session the pump currently posts frames through. Set by
  // sessionLoop$ below on every (re)spawn and recycle; undefined between
  // deactivation and the next session.
  let currentSession: WorkerSession | undefined;
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
  // Keeps the screen awake while scanning; a dash-mounted phone that sleeps
  // mid-drive stops seeing the road with no sign anything changed.
  const wakeLock = createWakeLockManager();

  const clearTimers = () => {
    window.clearTimeout(retryTimer);
    window.clearTimeout(paceTimer);
  };

  /** Swap in the next contact (or none), closing the previous crop bitmap. */
  const replaceContact = (next: Contact | undefined) => {
    snapshot$.value.contact?.image.close();
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
        graphCapture: snapshot$.value.backendProbe?.graphCapture,
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

  /** Publish a status change; the effect stream below reacts to its edges. */
  const setStatus = (next: DetectionStatus) => {
    if (next !== snapshot$.value.status) {
      publish({ status: next });
    }
  };

  // The scanning-window side effects (telemetry clock, crash sentinel, wake
  // lock) attach to status edges on the published stream, so they can never
  // miss a transition no matter which code path publishes it. pairwise on a
  // BehaviorSubject pairs the initial value with the first change, so the
  // first entry into "running" is seen.
  snapshot$
    .pipe(
      map((s) => s.status),
      distinctUntilChanged(),
      pairwise(),
    )
    .subscribe(([previous, next]) => {
      if (next === "running") {
        telemetry.scanningStarted();
        sentinelStart();
        void wakeLock.acquire();
      } else if (previous === "running") {
        telemetry.scanningStopped();
        sentinelStop();
        void wakeLock.release();
      }
    });

  const sendFrame = async () => {
    const video = inputs$.value.video;
    if (!running || !video || !currentSession) {
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
      const zoom = settings$.value.zoom;
      // Recorded before the transfer detaches the bitmap.
      lastFrameInfo = { zoom, width: frame.width, height: frame.height };
      currentSession.post(
        {
          type: "detect",
          frame,
          includeCrop: settings$.value.includeContact,
          zoom,
          confidenceThreshold: settings$.value.confidenceThreshold,
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
    const delay = settings$.value.throttled
      ? Math.max(floorDelay, restDelay)
      : 0;
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

  /** One spawned worker: its post channel, parsed messages, and load state. */
  type WorkerSession = {
    post: DetectionWorkerLike["postMessage"];
    messages$: Observable<WorkerResponse>;
    loaded$: BehaviorSubject<boolean>;
    createdAt: number;
  };

  // Ends the current activation's inner work after a worker error. Nothing
  // runs again until deactivate then activate, matching the old halt.
  const halt$ = new Subject<void>();
  // Completes the current worker session so repeat() spawns a fresh one; the
  // detections handler fires it at a result boundary once the worker's age
  // passes WORKER_RECYCLE_AFTER_MS.
  const recycle$ = new Subject<void>();

  const haltForError = () => {
    running = false;
    workerLoaded = false;
    generation += 1;
    inFlight = 0;
    clearTimers();
    replaceContact(undefined);
    halt$.next();
  };

  /**
   * One worker lifetime as an Observable: subscribing spawns the worker,
   * posts the probe synchronously (the GPU verdict must not wait on anything),
   * and requests the model load once a service worker controls the page so a
   * first visit's fetch lands in the runtime cache (dev has none, load
   * immediately). Unsubscribing terminates the worker and abandons a pending
   * load wait, which is what retires the old activation-counter guard.
   */
  const workerSession$ = new Observable<WorkerSession>((subscriber) => {
    const target = createWorker();
    const messages = new Subject<WorkerResponse>();
    const loaded$ = new BehaviorSubject(false);
    target.onmessage = (event: MessageEvent) => {
      const message: unknown = event.data;
      if (isWorkerResponse(message)) {
        messages.next(message);
      }
    };
    target.onerror = () => {
      telemetry.error("WORKER_CRASHED");
      publish({ error: "WORKER_CRASHED" });
      setStatus("error");
      haltForError();
    };
    target.postMessage({ type: "probe" });
    let cancelled = false;
    const startLoad = import.meta.env.PROD
      ? waitForServiceWorkerControl(SW_CONTROL_TIMEOUT_MS)
      : Promise.resolve();
    void startLoad.then(() => {
      if (!cancelled) {
        target.postMessage({ type: "load", model });
      }
    });
    subscriber.next({
      post: (message, transfer) => {
        target.postMessage(message, transfer);
      },
      messages$: messages,
      loaded$,
      createdAt: performance.now(),
    });
    return () => {
      cancelled = true;
      target.terminate();
    };
  });

  const handleMessage = (session: WorkerSession, message: WorkerResponse) => {
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
        session.loaded$.next(true);
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
          confidenceThreshold: settings$.value.confidenceThreshold,
          updateTracks: (detections) => tracker.update(detections),
          includeContact: settings$.value.includeContact,
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
          snapshot$.value.contact?.image.close();
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
          performance.now() - session.createdAt >= WORKER_RECYCLE_AFTER_MS
        ) {
          // Invalidate any capture from the old pump so it can't post onto
          // the new worker, and drop the in-flight count for the restart.
          generation += 1;
          inFlight = 0;
          clearTimers();
          workerLoaded = false;
          recycle$.next();
        } else {
          schedulePacedFrame(roundTripMs);
        }
        break;
      }
      case "worker-error": {
        telemetry.error(message.code, message.detail);
        publish({ error: message.code });
        setStatus("error");
        haltForError();
        break;
      }
    }
  };

  // One activation's worker chain: sessions repeat on recycle and end on
  // halt; flipping active$ off unsubscribes the current session, which is
  // what terminates its worker.
  const sessionLoop$ = workerSession$.pipe(
    tap((session) => {
      currentSession = session;
      workerLoaded = false;
    }),
    switchMap((session) =>
      session.messages$.pipe(tap((message) => handleMessage(session, message))),
    ),
    takeUntil(recycle$),
    repeat(),
    takeUntil(halt$),
  );

  active$
    .pipe(
      distinctUntilChanged(),
      switchMap((isActive) => (isActive ? sessionLoop$ : EMPTY)),
    )
    .subscribe();

  // The old evaluate(): act on the edges of the derived running state. The
  // BehaviorSubject replays the initial false at subscribe; its "falling edge"
  // actions are all no-ops against fresh state, so no skip is needed.
  running$.subscribe((isRunning) => {
    running = isRunning;
    if (isRunning) {
      if (snapshot$.value.status === "ready") {
        setStatus("running");
        void sendFrame();
      }
      return;
    }
    generation += 1;
    clearTimers();
    tracker = createDetectionTracker();
    if (snapshot$.value.status === "running") {
      setStatus("ready");
    }
  });

  return {
    getSnapshot: () => snapshot$.value,
    subscribe: (onChange) => {
      // Skip the BehaviorSubject's replay: the seam's contract is
      // notify-on-change, and useSyncExternalStore reads the current value
      // itself via getSnapshot.
      const subscription = snapshot$.pipe(skip(1)).subscribe(onChange);
      return () => {
        subscription.unsubscribe();
      };
    },
    setInputs: (next) => {
      inputs$.next({ ...inputs$.value, ...next });
    },
    updateSettings: (next) => {
      settings$.next(next);
    },
    getDebugSnapshot: () => debug,
    activate: () => {
      if (active$.value) {
        return;
      }
      // A fresh activation behaves like a fresh mount: published state and
      // per-load counters reset before the new worker reports anything.
      snapshot$.value.contact?.image.close();
      snapshot$.next(INITIAL_SNAPSHOT);
      fileProgress.clear();
      debug = INITIAL_DEBUG;
      inFlight = 0;
      generation += 1;
      tracker = createDetectionTracker();
      active$.next(true);
    },
    deactivate: () => {
      if (!active$.value) {
        return;
      }
      active$.next(false);
      clearTimers();
      replaceContact(undefined);
      workerLoaded = false;
      inFlight = 0;
      generation += 1;
    },
  };
};
