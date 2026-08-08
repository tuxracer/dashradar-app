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
  scan,
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
  MAX_SESSION_EVENTS,
  writeHeartbeat,
} from "@/lib/crashSentinel";
import type { SessionEvent, SessionEventKind } from "@/lib/crashSentinel";
import { CONFIDENCE_THRESHOLD } from "@/lib/detection";
import type { Size } from "@/lib/detection";
import { reportableModelName } from "@/lib/detectionModels";
import type { DetectionModel } from "@/lib/detectionModels";
import type { DetectionTelemetry } from "@/lib/detectionTelemetry";
import { createDetectionTracker } from "@/lib/detectionTracker";
import type { Contact } from "@/lib/processDetectionResult";
import { processDetectionResult } from "@/lib/processDetectionResult";
import { waitForServiceWorkerControl } from "@/lib/serviceWorker";
import { screenWakeLock } from "@/lib/wakeLock";
import { INPUT_SIZE, ZOOM_OFF } from "@/workers/detection/consts";
// Safe where the worker's own index is not (no onnxruntime behind it). The crop
// geometry must be identical on both sides of the message.
import { centerCropRegion } from "@/workers/detection/inference";
import type { WorkerResponse, ZoomLevel } from "@/workers/detection/types";
import { isWorkerResponse } from "@/workers/detection/types";
import {
  BYTES_PER_MIB,
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
 * How long the pump idles after a result. Two rules compete and the longer wins:
 * a floor for fast devices, a rest proportional to the round trip for the rest.
 * The multiple climbs past PACING_REST_RAMP_MS, so a throttling phone sheds load
 * instead of stretching the same load out at a constant duty cycle.
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
 * Capture the region the model reads, already scaled to its input, so the bitmap
 * crossing to the worker is the input rather than four times it. The resize is a
 * request the platform may decline, so the worker never trusts the size.
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
    // The frames the model reads should not get softer to save a copy.
    resizeQuality: "medium",
  });
};

/**
 * The worker lifecycle and frame-pump stream graph, with no React in it.
 * `activate` spawns the worker and `deactivate` releases it.
 *
 * Whether the pump runs is derived, never commanded, and everything scoped to a
 * running span is subscribed under running$, so a falling edge tears it all down
 * and the race invariants follow from that scoping rather than from counters.
 */
export const createDetectionEngine = ({
  model,
  createWorker,
  telemetry,
  deferModelLoad = false,
}: {
  model: DetectionModel;
  createWorker: () => DetectionWorkerLike;
  telemetry: DetectionTelemetry;
  /** Start with the weights held back; see `modelLoadAllowed$` below. */
  deferModelLoad?: boolean;
}): DetectionEngine => {
  /** How this engine's model is named anywhere it is reported. */
  const reportedModel = reportableModelName(model);

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
    activeView: "radar",
  });
  const settings$ = new BehaviorSubject<EngineSettings>({
    includeContact: false,
    throttled: true,
    sceneGate: true,
    zoom: ZOOM_OFF,
    confidenceThreshold: CONFIDENCE_THRESHOLD,
    consoleDiagnostics: false,
  });
  const active$ = new BehaviorSubject(false);

  /**
   * Whether the worker may fetch the weights yet, opened by `allowModelLoad`.
   * The GPU probe stays outside the gate, so an unsupported device is turned away
   * without waiting on it. Monotonic, so a recycle never waits twice.
   */
  const modelLoadAllowed$ = new BehaviorSubject(!deferModelLoad);

  /** Whether this world state wants the pump running. */
  const wantsToRun = (
    isActive: boolean,
    { video, visible, settingsOpen }: EngineInputs,
  ) => isActive && video !== undefined && visible && !settingsOpen;

  /**
   * The derived running state; everything scoped to a running span hangs off it.
   * Cold by design, not an oversight to fix with shareReplay: that is what hands
   * a late subscriber, like a recycled session's pump, the current value.
   */
  const running$ = combineLatest([active$, inputs$]).pipe(
    map(([isActive, inputs]) => wantsToRun(isActive, inputs)),
    distinctUntilChanged(),
  );

  // ---- pump state ----
  /**
   * The most recently posted frame. Worker replies do not echo the frame they
   * answer, so this is how a result learns its geometry; correct because only one
   * frame is ever in flight. Never cleared, so readers guard it.
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
  // Recreated on every pump stop, so a resumed session re-earns confirmation.
  let tracker = createDetectionTracker();
  const fileProgress = new Map<string, ModelProgress>();
  // Frames the pump completed, gate skips included: what the sentinel measures is
  // whether the pump kept turning over, which a session at a light is doing.
  let framesTotal = 0;
  /** The subset that actually ran the model, which is a different question. */
  let scansTotal = 0;
  /** Sessions started, the first included, so recycles are one fewer. */
  let workersStarted = 0;
  /** Its age says whether a kill landed near the recycle boundary. */
  let workerStartedAt = performance.now();
  /**
   * ImageBitmaps this thread owns. A count rather than a collection on purpose: a
   * set would keep the leak it is meant to detect alive.
   */
  let ownedBitmaps = 0;
  /**
   * The worker's wasm heap as of its last reply carrying one. An iOS memory kill
   * runs no JS, so the size at death is only knowable if written down first.
   */
  let wasmHeapBytes: number | undefined;

  /** Rolling log of what this engine did, oldest first. */
  const sessionEvents: SessionEvent[] = [];
  /**
   * Fires when an event should not wait for the next scheduled heartbeat. Only
   * the sentinel listens, so recording outside a scanning window is free.
   */
  const eventBeat$ = new Subject<void>();

  /**
   * Mirror a line to the console for a tethered Web Inspector session. Unlike the
   * sentinel log this never leaves the device, so free text is allowed.
   */
  const consoleDiagnostic = (line: string): void => {
    if (!settings$.value.consoleDiagnostics) {
      return;
    }
    console.info(`[dashradar] ${line}`);
  };

  /**
   * Append to the log, and for everything but the per-frame kinds beat on the
   * spot. Scans and skips arrive every second and the next beat catches them
   * anyway; the rare moments are the ones whose timing has to survive a kill.
   */
  const recordEvent = (kind: SessionEventKind, detail?: string): void => {
    sessionEvents.push({ at: Date.now(), kind, detail });
    if (sessionEvents.length > MAX_SESSION_EVENTS) {
      sessionEvents.shift();
    }
    const line = detail ? `${kind} ${detail}` : kind;
    // Per-frame lines carry what a memory investigation reads.
    consoleDiagnostic(
      kind === "scan" || kind === "skip"
        ? `${line} · heap ${wasmHeapBytes === undefined ? "?" : `${(wasmHeapBytes / BYTES_PER_MIB).toFixed(1)} MiB`} · bitmaps ${ownedBitmaps} · frame ${framesTotal}`
        : line,
    );
    if (kind !== "scan" && kind !== "skip") {
      eventBeat$.next();
    }
  };

  /**
   * The single close site for owned bitmaps, so the count cannot drift. The
   * teardown doorman below is the one exception, closing an uncounted crop.
   */
  const releaseBitmap = (bitmap: ImageBitmap | undefined): void => {
    if (!bitmap) {
      return;
    }
    bitmap.close();
    ownedBitmaps -= 1;
  };
  /**
   * When the model last ran, or undefined since the pump started. Kept here
   * rather than in the worker, which cannot see a pause or a recycle.
   */
  let lastScanAt: number | undefined;
  let debug: DebugSnapshot = INITIAL_DEBUG;

  /**
   * The single close site for contact crops. Callers publish the returned value
   * themselves, so a swap can be batched into a larger patch.
   */
  const swapContact = (next: Contact | undefined): Contact | undefined => {
    releaseBitmap(snapshot$.value.contact?.image);
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
  // The telemetry clock, the crash sentinel, and the wake lock are each a stream
  // whose teardown is its own release, so a window is a subscribe and no more.

  /** The telemetry scanning clock, running while subscribed. */
  const scanClock$ = new Observable<never>(() => {
    telemetry.scanningStarted();
    return () => {
      telemetry.scanningStopped();
    };
  });

  /**
   * While subscribed, beat a timestamped record into localStorage so the next
   * launch can tell whether this session ended cleanly. Unsubscribing clears it,
   * so only an OS kill, which runs no JS, leaves a heartbeat behind.
   */
  const crashSentinel$ = defer(() => {
    const startedAt = Date.now();
    const baseline = framesTotal;
    const scanBaseline = scansTotal;
    const beat = () => {
      writeHeartbeat({
        startedAt,
        lastBeatAt: Date.now(),
        framesProcessed: framesTotal - baseline,
        scansProcessed: scansTotal - scanBaseline,
        graphCapture: snapshot$.value.backendProbe?.graphCapture,
        // The writing build, not the one that happens to read the record.
        release: APP_RELEASE,
        // Per beat: the view changes under a running session.
        activeView: inputs$.value.activeView,
        model: reportedModel,
        recycles: Math.max(0, workersStarted - 1),
        workerAgeMs: Math.round(performance.now() - workerStartedAt),
        ownedBitmaps,
        wasmHeapBytes,
        // Copied: a shared array would let a later push edit what was written.
        events: [...sessionEvents],
      });
    };
    beat();
    return merge(
      // Re-deferred per repeat, so the delay tracks current uptime: one second
      // through startup, five after.
      defer(() => timer(heartbeatDelayMs(Date.now() - startedAt))).pipe(
        repeat(),
        tap(beat),
      ),
      // Without this the record trails reality by a beat, so a crash moments
      // after a view switch is reported against the wrong view.
      eventBeat$.pipe(tap(beat)),
      // The last synchronous chance to clear the record; a real crash never
      // fires pagehide, so genuine kills still leave it behind. Covers the error
      // phase, whose activation is gone while the sentinel keeps watching.
      fromEvent(window, "pagehide").pipe(tap(clearSentinel)),
    );
  }).pipe(ignoreElements(), finalize(clearSentinel));

  // A phone that sleeps mid-drive stops seeing the road with no sign anything
  // changed. Built once per engine, so a refusal is reported once.
  const wakeLock$ = screenWakeLock();

  // Keyed on the published status, so no code path can publish a transition
  // these miss. Both end with scanning.
  snapshot$
    .pipe(
      map((s) => s.status === "running"),
      distinctUntilChanged(),
      switchMap((isScanning) =>
        isScanning ? merge(scanClock$, wakeLock$) : EMPTY,
      ),
    )
    .subscribe();

  // The sentinel additionally rides out an error that halted scanning, so a page
  // killed on the error screen still reports the record its log just captured.
  // The next activation resets the status and closes this window. An error with
  // no scanning behind it never opens one.
  snapshot$
    .pipe(
      map((s) => s.status),
      scan(
        (open: boolean, status) =>
          status === "running" || (open && status === "error"),
        false,
      ),
      distinctUntilChanged(),
      switchMap((open) => (open ? crashSentinel$ : EMPTY)),
    )
    .subscribe();

  /**
   * Capture one frame, waiting for a new camera frame first so inference never
   * runs twice on the same one. `cancelled` keeps a bitmap resolving after
   * teardown from leaking. A cutout needs the whole frame; otherwise the crop and
   * scale happen in `createImageBitmap`. `source` is the video's own size either
   * way, so a result maps its boxes against the frame.
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
          ownedBitmaps += 1;
          if (cancelled) {
            releaseBitmap(frame);
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
   * Apply the pacing rule and record it for the debug overlay. Unthrottled
   * collapses the delay to 0 but still reports the rule that would have applied.
   */
  const paceDelay = (elapsedSincePostMs: number): number => {
    const { delayMs, rule } = pacingDelay(elapsedSincePostMs);
    const delay = settings$.value.throttled ? delayMs : 0;
    debug = { ...debug, pacingDelayMs: delay, pacingRule: rule };
    return delay;
  };

  /**
   * Whether this frame must be scanned whatever the gate makes of it: the gate is
   * off, nothing has been scanned since the pump started (a resume can sit on any
   * amount of unobserved movement), or skipping has run past the backstop. All
   * three are the engine's to see and none the worker's.
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

  // Completes the current worker session so repeat() spawns a fresh one; the
  // pump's scanOnce fires it at a result boundary once the worker's age
  // passes WORKER_RECYCLE_AFTER_MS.
  const recycle$ = new Subject<void>();

  // Off inputs$ rather than setInputs, so a change is logged once however many
  // times it is pushed and the value at subscribe is not logged at all.
  recycle$.subscribe(() => recordEvent("recycle"));
  inputs$
    .pipe(
      map(({ activeView }) => activeView),
      distinctUntilChanged(),
      skip(1),
    )
    .subscribe((view) => recordEvent("view", view));
  inputs$
    .pipe(
      map(({ video }) => video !== undefined),
      distinctUntilChanged(),
      skip(1),
    )
    .subscribe((attached) => recordEvent("video", attached ? "on" : "off"));

  /**
   * End the activation after a worker error by riding the same falling edge
   * deactivate() does. It has to be this edge: activate() early-returns while
   * active$ is true, so a halt that left it true could never be restarted.
   */
  const haltForError = () => {
    replaceContact(undefined);
    active$.next(false);
  };

  /**
   * One worker lifetime as an Observable: subscribing spawns it, probes
   * synchronously, and requests the load once both gates are open. Unsubscribing
   * terminates it.
   */
  const workerSession$ = new Observable<WorkerSession>((subscriber) => {
    workersStarted += 1;
    workerStartedAt = performance.now();
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
      recordEvent("error", "WORKER_CRASHED");
      telemetry.error("WORKER_CRASHED");
      publish({ error: "WORKER_CRASHED" });
      setStatus("error");
      haltForError();
    };
    target.postMessage({ type: "probe" });
    // Two independent waits: the owner's go-ahead, and in production a service
    // worker controlling the page so a first visit's fetch is cached.
    // Unsubscribing stops a terminated worker from being posted to.
    const loadRequest = combineLatest([
      modelLoadAllowed$.pipe(filter(Boolean)),
      defer(() =>
        import.meta.env.PROD
          ? waitForServiceWorkerControl(SW_CONTROL_TIMEOUT_MS)
          : Promise.resolve(),
      ),
    ])
      .pipe(take(1))
      .subscribe(() => {
        target.postMessage({ type: "load", model });
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
      loadRequest.unsubscribe();
      // A message posted before teardown can still be dispatched after it, when
      // the subscribers are gone, leaving a crop with no owner.
      target.onmessage = (event: MessageEvent) => {
        const message: unknown = event.data;
        if (isWorkerResponse(message) && message.type === "detections") {
          message.crop?.image.close();
        }
      };
      target.terminate();
    };
  });

  /** A reply without a heap size leaves the last reading in place. */
  const recordWasmHeap = (bytes: number | undefined): void => {
    if (bytes !== undefined) {
      wasmHeapBytes = bytes;
    }
  };

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
        const { graphCapture, threads, sessionError, graphCaptureError } =
          message.probe;
        consoleDiagnostic(
          `backend-probe · graphCapture ${String(graphCapture)} · threads ${threads}` +
            (sessionError ? ` · sessionError ${sessionError}` : "") +
            (graphCaptureError ? ` · captureError ${graphCaptureError}` : ""),
        );
        publish({ backendProbe: message.probe });
        break;
      }
      case "ready": {
        session.loaded$.next(true);
        recordWasmHeap(message.wasmHeapBytes);
        recordEvent("load");
        telemetry.modelReady();
        // Republished per recycle, so a session naming nothing is reported that
        // way rather than keeping the last session's words.
        publish({ loadedClasses: message.loaded?.classes });
        setStatus(
          wantsToRun(active$.value, inputs$.value) ? "running" : "ready",
        );
        break;
      }
      case "scan-skipped": {
        framesTotal += 1;
        recordWasmHeap(message.wasmHeapBytes);
        recordEvent("skip");
        // A skip publishes nothing: a frame that did not change cannot have lost
        // what the last one found, and coasting the tracker would drop it.
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
        scansTotal += 1;
        recordWasmHeap(message.wasmHeapBytes);
        // Arrives transferred, so this thread owns it. processDetectionResult
        // hands it back as exactly one of contact or discardedCrop, so it is
        // counted once here and released once either way.
        if (message.crop) {
          ownedBitmaps += 1;
        }
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
        };
        // Raw per-frame output, not the coasted set: the view exists to show
        // what the model saw. Needs the frame's geometry to map boxes.
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
        // Before the publish, so the cleanup does not depend on how the
        // publish's subscribers behave.
        releaseBitmap(result.discardedCrop);
        publish(patch);
        const { preprocessMs, inferenceMs, decodeMs } = message.timing;
        const roundTripMs = performance.now() - (frame?.postedAt ?? 0);
        debug = {
          captureMs: frame?.captureMs ?? 0,
          preprocessMs,
          inferenceMs,
          decodeMs,
          roundTripMs,
          // What the worker's stages do not account for: delivery and
          // scheduling. Clamped to absorb cross-thread clock noise.
          overheadMs: Math.max(
            0,
            roundTripMs - (preprocessMs + inferenceMs + decodeMs),
          ),
          rawCount: message.detections.length,
          filteredCount: result.detections.length,
          shownCount: result.tracked.length,
          zoom: frame?.zoom ?? ZOOM_OFF,
          // Owned by the pump's retry loop, so a result never erases a streak.
          captureFailures: debug.captureFailures,
          // Carried for one line; paceDelay writes this frame's own decision.
          pacingDelayMs: debug.pacingDelayMs,
          pacingRule: debug.pacingRule,
          // Still reported: readings above the threshold are half of tuning it.
          sceneDelta: message.sceneDelta ?? debug.sceneDelta,
          scanSkips: 0,
          scansTotal: debug.scansTotal + 1,
          skipsTotal: debug.skipsTotal,
        };
        recordEvent("scan", `${Math.round(roundTripMs)}ms`);
        telemetry.result({ inferenceMs, roundTripMs });
        break;
      }
      case "worker-error": {
        // reason is guard-enforced to the WebGPU enum so it may ship; detail is
        // whatever the platform said, so it may not.
        recordEvent(
          "error",
          message.reason ? `${message.code} ${message.reason}` : message.code,
        );
        // Out of the shipped log, but the best line a tethered console can show.
        if (message.detail) {
          consoleDiagnostic(`worker-error detail: ${message.detail}`);
        }
        telemetry.error(message.code, message.detail);
        publish({ error: message.code });
        setStatus("error");
        haltForError();
        break;
      }
    }
  };

  /**
   * The frame pump for one session: runs while running$ is true, starts only
   * after this session reports ready, and loops forever. A falling edge
   * unsubscribes mid-anything except a frame already posted, which
   * `awaitingResult` tracks across the edge so a stop/start that outraces the
   * reply does not put a second frame in flight.
   */
  const pumpFor = (session: WorkerSession) => {
    let awaitingResult = false;

    /**
     * Every reply that closes out a posted frame. A gate skip counts, or the pump
     * waits on an answered frame and the watchdog recycles a healthy worker.
     */
    const replies$ = session.messages$.pipe(
      filter(
        (message) =>
          message.type === "detections" || message.type === "scan-skipped",
      ),
    );

    // Not gated by running: a stale result landing during a pause must still
    // clear the flag, or a resumed pump waits on a message it already missed.
    const resultLanded$ = replies$.pipe(
      tap(() => {
        awaitingResult = false;
      }),
      ignoreElements(),
    );

    /**
     * The next reply, bounded by the watchdog: a worker silent this long is wedged
     * in a way no other signal reports, so recycle rather than await forever.
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
     * Capture, then post with the reply listener already in place: merge
     * subscribes nextResult$ before the deferred post runs, so a responder that
     * answers synchronously cannot emit into nothing and stall the pump.
     */
    const postFrame = (video: HTMLVideoElement) => {
      // One read for the whole scan: the crop geometry and the declared zoom
      // must be the same value across the capture's await, or the worker maps
      // boxes out of a crop it was never told about.
      const { zoom, includeContact, confidenceThreshold, sceneGate } =
        settings$.value;
      return captureFrame(video, includeContact ? undefined : zoom).pipe(
        switchMap(({ frame, captureMs, source }) =>
          merge(
            nextResult$,
            defer(() => {
              // The video's size, not the bitmap's: everything downstream works
              // against the frame, not the model's input.
              postedFrame = {
                zoom,
                width: source.width,
                height: source.height,
                captureMs,
                postedAt: performance.now(),
              };
              awaitingResult = true;
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
              // Transferred, not closed: the bitmap is the worker's now.
              ownedBitmaps -= 1;
              return EMPTY;
            }),
          ),
        ),
      );
    };

    /**
     * One iteration: capture and post, await the reply, then either pace the next
     * capture or complete the session for recycle.
     */
    const scanOnce = () =>
      defer(() => {
        if (awaitingResult) {
          return nextResult$;
        }
        const video = inputs$.value.video;
        // running$ implies a video is attached, so this should be unreachable;
        // the timer stops repeat() spinning if that coupling ever breaks.
        return video
          ? postFrame(video)
          : timer(FRAME_RETRY_MS).pipe(ignoreElements());
      }).pipe(
        switchMap(() => {
          // At this boundary, where nothing is in flight. Status stays "running"
          // so one-shot analytics gates never re-fire.
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
        // Retries forever: the expected cause is a video with no frame data yet,
        // which resolves itself. Quiet beyond the debug counter, so a persistent
        // failure shows as a climbing captureFailures readout.
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
              // Unbounded: the load watchdog recycles the session out from under
              // this wait if ready never comes.
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
   * The load-time counterpart of the reply watchdog, which cannot cover loading
   * because it only arms once a frame is posted. An inactivity bound rather than
   * a load budget: a load can be legitimately slow but never legitimately silent.
   * Starts when the download is allowed, or a deliberately held load would
   * recycle a healthy worker every minute.
   */
  const loadWatchdogFor = (session: WorkerSession) =>
    modelLoadAllowed$.pipe(
      filter(Boolean),
      take(1),
      switchMap(() =>
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
        ),
      ),
      takeUntil(session.loaded$.pipe(filter(Boolean))),
      ignoreElements(),
    );

  // Sessions repeat on recycle; flipping active$ off terminates the current
  // worker. The merge order is load-bearing: the message handler subscribes
  // before the pump, so a result is processed before pacing is computed from it.
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
  );

  active$
    .pipe(
      distinctUntilChanged(),
      switchMap((isActive) => (isActive ? sessionLoop$ : EMPTY)),
    )
    .subscribe();

  // Fires immediately with the initial false; those actions are all no-ops
  // against fresh state, so no skip is needed.
  running$.subscribe((isRunning) => {
    if (isRunning) {
      if (snapshot$.value.status === "ready") {
        setStatus("running");
      }
      return;
    }
    // A pause of any length can sit between these two frames, so a resumed
    // session re-earns confirmation and scans rather than measuring.
    tracker = createDetectionTracker();
    lastScanAt = undefined;
    if (snapshot$.value.status === "running") {
      setStatus("ready");
    }
  });

  const activate = (): void => {
    if (active$.value) {
      return;
    }
    releaseBitmap(snapshot$.value.contact?.image);
    snapshot$.next(INITIAL_SNAPSHOT);
    fileProgress.clear();
    debug = INITIAL_DEBUG;
    tracker = createDetectionTracker();
    lastScanAt = undefined;
    active$.next(true);
  };

  const deactivate = (): void => {
    if (!active$.value) {
      return;
    }
    active$.next(false);
    replaceContact(undefined);
  };

  // A departing page never runs React cleanups, so pagehide is the one
  // synchronous chance to terminate the worker. For memory, not tidiness: WebKit
  // reuses one process across same-site reloads and reclaims a dead page's wasm
  // memory and GPU handles lazily at best, so reloads stack residue until iOS
  // kills it. pagehide also fires into the bfcache, so the switchMap arms a
  // one-shot pageshow wait to reactivate on a restore.
  fromEvent(window, "pagehide")
    .pipe(
      filter(() => active$.value),
      tap(() => {
        deactivate();
      }),
      switchMap(() =>
        fromEvent<PageTransitionEvent>(window, "pageshow").pipe(
          filter((event) => event.persisted),
          take(1),
          takeUntil(active$.pipe(filter(Boolean))),
        ),
      ),
    )
    .subscribe(() => {
      activate();
    });

  return {
    getSnapshot: () => snapshot$.value,
    subscribe: (onChange) => {
      // Skip the replay: the contract is notify-on-change, and
      // useSyncExternalStore reads the current value via getSnapshot.
      const subscription = snapshot$.pipe(skip(1)).subscribe(onChange);
      return () => {
        subscription.unsubscribe();
      };
    },
    setInputs: (next) => {
      inputs$.next({ ...inputs$.value, ...next });
    },
    updateSettings: (next) => {
      // At the settings edge, because the worker stops producing crops the
      // moment it lands and no later result would swap this one out.
      if (!next.includeContact && snapshot$.value.contact) {
        replaceContact(undefined);
      }
      settings$.next(next);
    },
    getDebugSnapshot: () => debug,
    allowModelLoad: () => {
      modelLoadAllowed$.next(true);
    },
    activate,
    deactivate,
  };
};
