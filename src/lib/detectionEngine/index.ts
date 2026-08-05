import {
  BehaviorSubject,
  combineLatest,
  defer,
  distinctUntilChanged,
  EMPTY,
  filter,
  finalize,
  fromEvent,
  ignoreElements,
  map,
  merge,
  Observable,
  repeat,
  retry,
  skip,
  Subject,
  switchMap,
  take,
  takeUntil,
  tap,
  timeout,
  timer,
} from "rxjs";
import { APP_RELEASE } from "@/lib/appRelease";
import { waitForNextVideoFrame } from "@/lib/camera";
import {
  clearSentinel,
  heartbeatDelayMs,
  writeHeartbeat,
} from "@/lib/crashSentinel";
import { CONFIDENCE_THRESHOLD } from "@/lib/detection";
import type { Size } from "@/lib/detection";
import type { DetectionModel } from "@/lib/detectionModels";
import type { DetectionTelemetry } from "@/lib/detectionTelemetry";
import { createDetectionTracker } from "@/lib/detectionTracker";
import type { Contact } from "@/lib/processDetectionResult";
import { processDetectionResult } from "@/lib/processDetectionResult";
import { waitForServiceWorkerControl } from "@/lib/serviceWorker";
import { screenWakeLock } from "@/lib/wakeLock";
import { INPUT_SIZE, ZOOM_OFF } from "@/workers/detection/consts";
// The one module outside the worker that imports its inference helpers. Safe
// where the worker's own index is not: this file pulls in no onnxruntime, and
// the crop geometry has to be identical on both sides of the message or a
// pre-cropped frame and the boxes mapped back out of it disagree.
import { centerCropRegion } from "@/workers/detection/inference";
import type { WorkerResponse, ZoomLevel } from "@/workers/detection/types";
import { isWorkerResponse } from "@/workers/detection/types";
import {
  FRAME_RETRY_MS,
  INITIAL_DEBUG,
  INITIAL_SNAPSHOT,
  MAX_FRAME_INTERVAL_MS,
  MIN_FRAME_INTERVAL_MS,
  PACING_REST_RAMP_MS,
  PACING_REST_RATIO,
  PACING_REST_RATIO_MAX,
  SCENE_GATE_MAX_SKIP_MS,
  SW_CONTROL_TIMEOUT_MS,
  WORKER_LOAD_TIMEOUT_MS,
  WORKER_RECYCLE_AFTER_MS,
  WORKER_REPLY_TIMEOUT_MS,
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
  PacingDecision,
} from "./types";

export * from "./consts";
export * from "./types";

/**
 * How long the pump idles after a result before starting the next capture.
 *
 * Two rules compete and the longer wins. The floor keeps captures at least
 * MIN_FRAME_INTERVAL_MS apart, which is what paces a device fast enough that
 * back-to-back inference would peg its GPU. The rest keeps the GPU idle for a
 * multiple of the work it just did, which is what paces everything slower.
 *
 * The rest's multiple is not fixed. Heat tracks the share of wall time the GPU
 * spends busy, and a fixed multiple holds that share constant no matter how
 * slow the device gets: resting one round trip is 50% busy at a 500 ms round
 * trip and still 50% busy at 4 s. So the multiple climbs with the round trip
 * past PACING_REST_RAMP_MS, which turns a slower device into a genuinely
 * lighter load rather than the same load stretched out. A phone that throttles
 * therefore backs off the work that made it throttle, instead of settling into
 * the flat 50% duty cycle that got it there.
 *
 * MAX_FRAME_INTERVAL_MS bounds the result, because the ramp trades scan rate
 * away and that trade has a floor of usefulness.
 */
export const pacingDelay = (roundTripMs: number): PacingDecision => {
  const floorDelay = Math.max(0, MIN_FRAME_INTERVAL_MS - roundTripMs);
  const ratio = Math.min(
    PACING_REST_RATIO_MAX,
    Math.max(PACING_REST_RATIO, roundTripMs / PACING_REST_RAMP_MS),
  );
  const restDelay = ratio * roundTripMs;
  if (floorDelay >= restDelay) {
    return { delayMs: floorDelay, rule: "floor" };
  }
  if (restDelay > MAX_FRAME_INTERVAL_MS) {
    return { delayMs: MAX_FRAME_INTERVAL_MS, rule: "capped" };
  }
  return { delayMs: restDelay, rule: "rest" };
};

/**
 * Capture the region the model actually reads, already scaled to its input:
 * the centered square the zoom selects, resized to INPUT_SIZE on the way out.
 *
 * Doing the crop and the scale here rather than in the worker is what keeps a
 * full-resolution frame off the hot path when nothing needs one. The bitmap
 * that crosses to the worker is the model's input rather than four times it,
 * and the resample runs in the browser's own scaler instead of a software
 * downscale into the CPU-backed canvas the worker reads pixels out of.
 *
 * The resize is a request the platform may decline, so the worker scales
 * whatever arrives onto the input rather than trusting the size.
 */
const captureModelInput = (
  video: HTMLVideoElement,
  source: Size,
  zoom: ZoomLevel,
): Promise<ImageBitmap> => {
  const { sx, sy, side } = centerCropRegion(source.width, source.height, zoom);
  return createImageBitmap(video, sx, sy, side, side, {
    resizeWidth: INPUT_SIZE,
    resizeHeight: INPUT_SIZE,
    // At least the quality of the canvas downscale this replaces; the frames
    // the model reads should not get softer to save a copy.
    resizeQuality: "medium",
  });
};

/**
 * Build the detection engine: the worker lifecycle and frame-pump stream
 * graph, with no React anywhere in it. One engine spans one page load of
 * scanning; `activate` spawns the worker and `deactivate` releases it, so
 * the owner can treat the pair like mount and unmount.
 *
 * Whether the pump runs is derived, never commanded: running$ is true
 * exactly while the inputs say a video is attached, the page is visible,
 * and settings are closed, and everything scoped to a running span is
 * subscribed under it, so a falling edge tears the span down and there is
 * no pause/resume protocol to hold correctly at call sites.
 *
 * The race invariants the old imperative pump guarded with counters are
 * mostly structural here: no stale capture after a stop because teardown is
 * unsubscription, and no frame posted to a still loading worker because
 * each session's pump starts behind its ready. One frame in flight is the
 * sequential loop (capture, post, await result, pace, repeat) plus a single
 * non-structural residue, a session-scoped awaiting-result flag that covers
 * a stop/start landing while a reply is still outstanding.
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
    sceneGate: true,
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
   *
   * Cold by design, not an oversight to fix with shareReplay: each subscriber
   * (a session's pump, the edge watcher below) runs its own cheap
   * combineLatest over the BehaviorSubject sources, which is what hands a
   * late subscriber, like a recycled session's pump, the current value the
   * moment it subscribes.
   */
  const running$ = combineLatest([active$, inputs$]).pipe(
    map(([isActive, inputs]) => wantsToRun(isActive, inputs)),
    distinctUntilChanged(),
  );

  // ---- pump state ----
  /**
   * The most recently posted frame: the crop factor and dimensions a
   * result's boxes must be mapped against, plus the capture cost and post
   * time behind the debug snapshot's timings. Worker replies do not echo
   * the frame they answer, so this record is how a result learns about its
   * frame; it stays correct because only one frame is ever in flight. Like
   * the pump's `awaitingResult` flag, it is deliberate imperative state
   * alongside the streams (the flag covers control flow across a stop/start,
   * this covers the data riding with the outstanding frame). Never cleared:
   * a result no post preceded reads it guardedly instead.
   */
  let postedFrame:
    | {
        zoom: ZoomLevel;
        width: number;
        height: number;
        captureMs: number;
        postedAt: number;
      }
    | undefined;
  // Coasting tracker: shows each detection immediately and holds a stale box
  // for a few frames when the model briefly loses it. Recreated on every
  // pump stop, so a resumed session re-earns confirmation from scratch.
  let tracker = createDetectionTracker();
  const fileProgress = new Map<string, ModelProgress>();
  // Running total of scans this engine completed, counting the ones the
  // scene-change gate answered without running the model; the crash sentinel
  // reads it against a baseline captured when scanning starts. Skips count
  // because what the sentinel measures is whether the pump kept turning over,
  // and a gated session parked at a light is turning over perfectly well.
  let framesTotal = 0;
  /**
   * performance.now() of the last scan the model actually ran, or undefined
   * when it has not run since the pump last started. This is the whole of the
   * engine's side of the scene-change gate: it decides when skipping has gone
   * on long enough to demand a scan regardless, and it is kept here rather than
   * in the worker because the worker cannot see a pause, a resume, or a recycle
   * for what they are.
   */
  let lastScanAt: number | undefined;
  let debug: DebugSnapshot = INITIAL_DEBUG;

  /**
   * Close the published contact's crop bitmap and hand back its replacement.
   * Every path that swaps the contact goes through this one close: callers
   * publish the returned value themselves, so the detections handler can
   * batch the swap into a larger patch.
   */
  const swapContact = (next: Contact | undefined): Contact | undefined => {
    snapshot$.value.contact?.image.close();
    return next;
  };

  /** Swap in the next contact (or none) as its own publication. */
  const replaceContact = (next: Contact | undefined) => {
    publish({ contact: swapContact(next) });
  };

  /** Publish a status change; the scanning window below reacts to its edges. */
  const setStatus = (next: DetectionStatus) => {
    if (next !== snapshot$.value.status) {
      publish({ status: next });
    }
  };

  // ---- the scanning window ----
  // Three resources live exactly as long as the engine is scanning: the
  // telemetry clock, the crash sentinel, and the screen wake lock. Each is a
  // stream whose teardown is its own release, so the window is a subscribe
  // and an unsubscribe rather than paired start/stop calls with timers,
  // listeners, and flags kept alongside them.

  /** The telemetry scanning clock, running while subscribed. */
  const scanClock$ = new Observable<never>(() => {
    telemetry.scanningStarted();
    return () => {
      telemetry.scanningStopped();
    };
  });

  /**
   * The crash sentinel: while subscribed, write a timestamped record to
   * localStorage on a cadence so the NEXT launch can tell whether this session
   * ended cleanly. Unsubscribing clears the record, so only an OS-level kill
   * mid-scan (no JS runs) leaves the last heartbeat behind to be reported.
   */
  const crashSentinel$ = defer(() => {
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
    beat();
    return merge(
      // Each repeat re-defers, so the delay is recomputed against the current
      // uptime rather than fixed at subscribe: heartbeatDelayMs beats every
      // second through the startup window and every five after it, buying
      // one-second resolution on where in startup a crash landed without
      // extra writes to hours of scanning.
      defer(() => timer(heartbeatDelayMs(Date.now() - startedAt))).pipe(
        repeat(),
        tap(beat),
      ),
      // A reload or navigation away mid-scan can outrun any teardown path, so
      // pagehide is the last synchronous chance to clear the record; a real
      // crash never fires pagehide, so genuine kills still leave it behind.
      // The heartbeat above deliberately keeps running, so a bfcache return
      // rewrites the record on its next beat and restores coverage.
      fromEvent(window, "pagehide").pipe(tap(clearSentinel)),
    );
  }).pipe(ignoreElements(), finalize(clearSentinel));

  // Keeps the screen awake while scanning; a dash-mounted phone that sleeps
  // mid-drive stops seeing the road with no sign anything changed. Built once
  // per engine rather than per window, so a platform that refuses the lock is
  // reported once for the page load.
  const wakeLock$ = screenWakeLock();

  // The window opens and closes on the published status, so it cannot miss a
  // transition no matter which code path publishes it.
  snapshot$
    .pipe(
      map((s) => s.status === "running"),
      distinctUntilChanged(),
      switchMap((isScanning) =>
        isScanning ? merge(scanClock$, crashSentinel$, wakeLock$) : EMPTY,
      ),
    )
    .subscribe();

  /**
   * Capture one frame as an ImageBitmap. Waits for the camera to present a
   * new frame first, so inference never runs twice on the same frame when
   * detection outpaces the camera. Cancellation-aware: teardown mid-wait
   * abandons the capture, and a bitmap that resolves after teardown is closed
   * instead of leaked, which is what the `cancelled` flag exists to protect
   * against.
   *
   * Two shapes come out of here. When a cutout is wanted the whole video frame
   * is captured, because the contact card is cut from its original pixels.
   * Otherwise the zoom crop and the scale down to the model's input are asked
   * of `createImageBitmap` directly, which hands the worker a bitmap a quarter
   * the size to transfer and leaves it a straight copy onto the input instead
   * of a software resample of a frame four times larger. The emitted `source`
   * is the video's own size either way, so a result maps its boxes against the
   * frame rather than against whatever was captured.
   */
  const captureFrame = (
    video: HTMLVideoElement,
    cropTo: ZoomLevel | undefined,
  ) =>
    new Observable<{
      frame: ImageBitmap;
      captureMs: number;
      source: Size;
    }>((subscriber) => {
      let cancelled = false;
      void (async () => {
        try {
          await waitForNextVideoFrame(video);
          if (cancelled) {
            return;
          }
          const source = {
            width: video.videoWidth,
            height: video.videoHeight,
          };
          const captureStart = performance.now();
          const frame = await (cropTo === undefined
            ? createImageBitmap(video)
            : captureModelInput(video, source, cropTo));
          if (cancelled) {
            frame.close();
            return;
          }
          subscriber.next({
            frame,
            captureMs: performance.now() - captureStart,
            source,
          });
          subscriber.complete();
        } catch (error) {
          if (!cancelled) {
            subscriber.error(error);
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    });

  /**
   * Apply the pacing rule to this round trip and record the decision for the
   * debug overlay. Unthrottled (debug-only) collapses the delay to 0 but still
   * reports the rule that would have applied, so the overlay keeps meaning the
   * same thing with the option on.
   */
  const paceDelay = (elapsedSincePostMs: number): number => {
    const { delayMs, rule } = pacingDelay(elapsedSincePostMs);
    const delay = settings$.value.throttled ? delayMs : 0;
    debug = { ...debug, pacingDelayMs: delay, pacingRule: rule };
    return delay;
  };

  /**
   * Whether this frame must be scanned whatever the scene-change gate makes of
   * it. Three cases, all of them the engine's to see and none of them the
   * worker's:
   *
   * The gate is off, a developer option, so every frame is scanned and the
   * gate's effect on heat and on detections can be measured against its absence
   * on a real device.
   *
   * Nothing has been scanned since the pump last started. A pump starts on a
   * fresh worker, after a recycle, and on every resume from a pause, and in the
   * last of those the world has had an unbounded amount of time to move while
   * nobody was looking. The first frame of a span is the one frame the gate has
   * no honest baseline for.
   *
   * Or skipping has run past SCENE_GATE_MAX_SKIP_MS, the backstop against the
   * gate being wrong in the direction that matters. A threshold set above what
   * a distant vehicle produces, or a camera feed that has frozen, both look
   * from in here exactly like a scene that is genuinely still, and neither can
   * be told apart from it by measuring the frames harder.
   */
  const forceScan = (sceneGate: boolean): boolean =>
    !sceneGate ||
    lastScanAt === undefined ||
    performance.now() - lastScanAt >= SCENE_GATE_MAX_SKIP_MS;

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
  // pump's scanOnce fires it at a result boundary once the worker's age
  // passes WORKER_RECYCLE_AFTER_MS.
  const recycle$ = new Subject<void>();

  const haltForError = () => {
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
        session.loaded$.next(true);
        telemetry.modelReady();
        setStatus(
          wantsToRun(active$.value, inputs$.value) ? "running" : "ready",
        );
        break;
      }
      case "scan-skipped": {
        framesTotal += 1;
        // The one piece of state a skip publishes: the pump completed a scan,
        // which is what the radar sweep runs on. Without it a gated session
        // parked at a light freezes the sweep for the whole skip run, the
        // looks-dead-while-working presentation the gate must never produce.
        publish({ scanCompletedAt: performance.now() });
        // Everything else is left exactly as the last real scan published it.
        // A frame that did not change cannot have lost what the last one found,
        // so the tracker is not advanced (which would coast the detection
        // toward being dropped), the HUD is not rebuilt, and the contact card
        // keeps the picture it is showing.
        debug = {
          ...debug,
          sceneDelta: message.delta,
          scanSkips: debug.scanSkips + 1,
          skipsTotal: debug.skipsTotal + 1,
        };
        break;
      }
      case "detections": {
        framesTotal += 1;
        const at = performance.now();
        lastScanAt = at;
        const result = processDetectionResult({
          detections: message.detections,
          crop: message.crop,
          confidenceThreshold: settings$.value.confidenceThreshold,
          updateTracks: (detections) => tracker.update(detections, at),
          includeContact: settings$.value.includeContact,
          at,
        });
        const frame = postedFrame;
        const patch: Partial<DetectionSnapshot> = {
          hud: result.hud,
          scanCompletedAt: at,
        };
        // Publish this scan's own detections for the detection view. Raw
        // per-frame output, not the coasted set, since the view exists to
        // show what the model saw on each frame. Skipped when no frame was
        // recorded (a result no capture preceded), since mapping boxes
        // needs the frame's geometry.
        if (frame) {
          patch.scan = {
            detections: result.detections,
            tracks: result.tracked,
            frame: { width: frame.width, height: frame.height },
            zoom: frame.zoom,
            at,
          };
        }
        if (result.contact) {
          patch.contact = swapContact(result.contact);
        }
        publish(patch);
        result.discardedCrop?.close();
        const { preprocessMs, inferenceMs, decodeMs } = message.timing;
        const roundTripMs = performance.now() - (frame?.postedAt ?? 0);
        debug = {
          captureMs: frame?.captureMs ?? 0,
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
          zoom: frame?.zoom ?? ZOOM_OFF,
          // Owned by the pump's capture retry loop; carried through so a
          // result never erases an in-progress failure streak readout.
          captureFailures: debug.captureFailures,
          // Carried forward for one line; the pump's paceDelay writes this
          // frame's actual pacing decision.
          pacingDelayMs: debug.pacingDelayMs,
          pacingRule: debug.pacingRule,
          // A scan the gate let through, so the run of skips it ended is over.
          // The delta is reported all the same: the readings above the
          // threshold are half of what tuning it needs.
          sceneDelta: message.sceneDelta ?? debug.sceneDelta,
          scanSkips: 0,
          scansTotal: debug.scansTotal + 1,
          skipsTotal: debug.skipsTotal,
        };
        telemetry.result({ inferenceMs, roundTripMs });
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

  /**
   * The frame pump for one worker session: runs exactly while running$ is
   * true, starts only after this session's model reports ready (a still
   * loading worker silently drops frames), and loops a scan forever. A
   * falling running edge unsubscribes mid-anything: a pending capture closes
   * its bitmap and a pending pace timer dies. The one exception is a frame
   * already posted and awaiting a reply: `awaitingResult` tracks that across
   * the edge (cleared by `resultLanded$` below, which stays subscribed
   * through a pause) so a stop/start that outraces the worker's reply
   * re-primes at depth one instead of posting a second frame while the first
   * is still out, keeping at most one frame in flight at a time.
   */
  const pumpFor = (session: WorkerSession) => {
    let awaitingResult = false;

    /**
     * Every reply that closes out a posted frame. A gate skip counts: it costs
     * the worker a frame and answers it, so to the pump it is a completed scan
     * that happens to carry no detections. Treating only results as replies
     * would leave the pump waiting on a frame that was already answered, and
     * the reply watchdog would recycle a worker doing exactly what it should.
     */
    const replies$ = session.messages$.pipe(
      filter(
        (message) =>
          message.type === "detections" || message.type === "scan-skipped",
      ),
    );

    // Not gated by running: a stale result landing during a pause must still
    // clear the flag, or a resumed pump would wait forever for a message
    // its own (torn-down) subscription already missed.
    const resultLanded$ = replies$.pipe(
      tap(() => {
        awaitingResult = false;
      }),
      ignoreElements(),
    );

    /**
     * The next detections result this session delivers, bounded by the reply
     * watchdog: a worker that answers with neither a result nor an error
     * within WORKER_REPLY_TIMEOUT_MS is wedged in a way no other signal
     * reports (onerror covers crashes, the crash sentinel covers OS kills),
     * so the timeout recycles it instead of awaiting the reply forever. The
     * outstanding frame dies with the terminated worker; the fresh session's
     * ready re-primes the pump.
     */
    const nextResult$ = replies$.pipe(
      take(1),
      timeout({
        first: WORKER_REPLY_TIMEOUT_MS,
        with: () =>
          defer(() => {
            telemetry.workerHung();
            recycle$.next();
            return EMPTY;
          }),
      }),
    );

    /**
     * Capture a frame, then post it with the reply listener already in
     * place: merge subscribes nextResult$ before the deferred post runs, so
     * the reply cannot race the listener. The pump would otherwise depend on
     * worker replies arriving on a later macrotask, a scheduling guarantee
     * rather than a structural one, and a responder that answered
     * synchronously (a test fake, a same-thread worker shim) would emit into
     * nothing and stall the pump forever.
     */
    const postFrame = (video: HTMLVideoElement) => {
      // One settings read for the whole scan, taken before the capture rather
      // than after it. The crop geometry and the zoom the message declares have
      // to be the same value or the worker maps the boxes back out of a crop it
      // was never told about, and only a single read can guarantee that across
      // the capture's await.
      const { zoom, includeContact, confidenceThreshold, sceneGate } =
        settings$.value;
      return captureFrame(video, includeContact ? undefined : zoom).pipe(
        switchMap(({ frame, captureMs, source }) =>
          merge(
            nextResult$,
            defer(() => {
              // The video's size, not the bitmap's: a pre-cropped capture is
              // the model's input, while everything downstream of a result
              // works against the frame it came from.
              postedFrame = {
                zoom,
                width: source.width,
                height: source.height,
                captureMs,
                postedAt: performance.now(),
              };
              awaitingResult = true;
              // A capture made it through, so any failure streak is over.
              debug = { ...debug, captureFailures: 0 };
              session.post(
                {
                  type: "detect",
                  frame,
                  includeCrop: includeContact,
                  zoom,
                  source: includeContact ? undefined : source,
                  confidenceThreshold,
                  forceScan: forceScan(sceneGate),
                },
                [frame],
              );
              return EMPTY;
            }),
          ),
        ),
      );
    };

    /**
     * One pump iteration: capture and post, then await the reply (a frame
     * from before an interruption still outstanding skips straight to the
     * awaiting), then either pace the next capture or complete the session
     * for recycle. A capture failure (video not delivering frames yet,
     * typically mid-attach) retries after FRAME_RETRY_MS.
     */
    const scanOnce = () =>
      defer(() => {
        if (awaitingResult) {
          return nextResult$;
        }
        const video = inputs$.value.video;
        // running$ implies a video is attached, so this branch is believed
        // unreachable. The timer is a belt-and-braces guard: if that
        // coupling ever breaks, it stops repeat() from spinning
        // synchronously on a missing video instead of retrying quietly.
        return video
          ? postFrame(video)
          : timer(FRAME_RETRY_MS).pipe(ignoreElements());
      }).pipe(
        switchMap(() => {
          // Recycle at this result boundary, where nothing is in flight, once
          // the worker has run long enough; terminating and recreating it
          // resets the native memory ORT and the GPU stack leak across
          // thousands of runs. Status stays "running" so one-shot analytics
          // gates never re-fire; the new session's ready re-primes the pump.
          if (
            performance.now() - session.createdAt >=
            WORKER_RECYCLE_AFTER_MS
          ) {
            recycle$.next();
            return EMPTY;
          }
          return timer(
            paceDelay(performance.now() - (postedFrame?.postedAt ?? 0)),
          );
        }),
        // A failed capture retries forever: the expected cause is a video
        // element with no frame data yet (typically mid-attach), which
        // resolves itself moments later. The retry is deliberately quiet
        // beyond the debug counter; stall detection and recovery were
        // removed on purpose, so a persistent failure shows up as a climbing
        // captureFailures readout rather than an alert.
        retry({
          delay: () => {
            debug = { ...debug, captureFailures: debug.captureFailures + 1 };
            return timer(FRAME_RETRY_MS);
          },
        }),
      );

    const captureLoop$ = running$.pipe(
      switchMap((isRunning) =>
        isRunning
          ? session.loaded$.pipe(
              // Unbounded on purpose: the session's load watchdog bounds how
              // long a worker may sit unloaded, so a ready that never comes
              // recycles the session out from under this wait.
              filter(Boolean),
              take(1),
              switchMap(() => scanOnce().pipe(repeat())),
            )
          : EMPTY,
      ),
    );

    return merge(resultLanded$, captureLoop$);
  };

  /**
   * The load watchdog for one worker session: until the model reports ready,
   * some message must arrive every WORKER_LOAD_TIMEOUT_MS or the session is
   * recycled as wedged. An inactivity bound rather than a load budget, because
   * a load can be legitimately slow (a first visit streams the weights over
   * whatever network the car is on) but never legitimately silent: every stage
   * posts something, so only a hang resets nothing. This is the load-time
   * counterpart of the pump's reply watchdog, which cannot cover loading
   * because it only arms once a frame is posted, and a frame is never posted
   * to a session that never reports ready. Ready ends the watch; from there
   * silence is normal idling and the reply watchdog owns wedge detection.
   */
  const loadWatchdogFor = (session: WorkerSession) =>
    session.messages$.pipe(
      timeout({
        first: WORKER_LOAD_TIMEOUT_MS,
        each: WORKER_LOAD_TIMEOUT_MS,
        with: () =>
          defer(() => {
            telemetry.workerHung();
            recycle$.next();
            return EMPTY;
          }),
      }),
      takeUntil(session.loaded$.pipe(filter(Boolean))),
      ignoreElements(),
    );

  // One activation's worker chain: sessions repeat on recycle and end on
  // halt; flipping active$ off unsubscribes the current session, which is
  // what terminates its worker. The merge order is load-bearing: the message
  // handler subscribes to messages$ before the pump, so it processes a
  // result (publishing hud/scan/contact and writing the debug timings)
  // before the pump's take(1) computes pacing.
  const sessionLoop$ = workerSession$.pipe(
    switchMap((session) =>
      merge(
        session.messages$.pipe(
          tap((message) => handleMessage(session, message)),
          ignoreElements(),
        ),
        loadWatchdogFor(session),
        pumpFor(session),
      ),
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

  // Act on the edges of the derived running state. running$'s BehaviorSubject
  // sources emit at subscribe, so this fires immediately with the initial
  // false; those "falling edge" actions are all no-ops against fresh state,
  // so no skip is needed.
  running$.subscribe((isRunning) => {
    if (isRunning) {
      if (snapshot$.value.status === "ready") {
        setStatus("running");
      }
      return;
    }
    // A resumed session must re-earn track confirmation from scratch, and for
    // the same reason it must re-look at the road: a pause of any length can
    // sit between these two frames, so the next one is scanned rather than
    // measured against a baseline from before it.
    tracker = createDetectionTracker();
    lastScanAt = undefined;
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
      // per-load state reset before the new worker reports anything.
      snapshot$.value.contact?.image.close();
      snapshot$.next(INITIAL_SNAPSHOT);
      fileProgress.clear();
      debug = INITIAL_DEBUG;
      tracker = createDetectionTracker();
      lastScanAt = undefined;
      active$.next(true);
    },
    deactivate: () => {
      if (!active$.value) {
        return;
      }
      active$.next(false);
      replaceContact(undefined);
    },
  };
};
