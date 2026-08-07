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
// Safe where the worker's own index is not (no onnxruntime behind it), and the
// crop geometry has to be identical on both sides of the message or a
// pre-cropped frame and the boxes mapped back out of it disagree.
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
 * How long the pump idles after a result before the next capture. Two rules
 * compete and the longer wins: the floor paces a device fast enough that
 * back-to-back inference would peg its GPU, the rest paces everything slower.
 *
 * The rest's multiple climbs with the round trip past PACING_REST_RAMP_MS. A
 * fixed multiple would hold the GPU's busy share constant however slow the
 * device got, so a throttling phone would stretch the same load out rather than
 * back off the load that made it throttle.
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
 * Capture the region the model reads, already scaled to its input. Cropping and
 * scaling here rather than in the worker keeps a full-resolution frame off the
 * hot path: the bitmap that crosses is the model's input rather than four times
 * it, resampled by the browser's scaler instead of a software downscale. The
 * resize is a request the platform may decline, so the worker scales whatever
 * arrives rather than trusting the size.
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
 * Build the detection engine: the worker lifecycle and frame-pump stream graph,
 * with no React in it. One engine spans one page load; `activate` spawns the
 * worker and `deactivate` releases it, so the owner treats the pair like mount
 * and unmount.
 *
 * Whether the pump runs is derived, never commanded, and everything scoped to a
 * running span is subscribed under running$, so a falling edge tears the span
 * down and no call site has to hold a pause/resume protocol correctly. The race
 * invariants follow from that scoping rather than from counters: no stale
 * capture after a stop, no frame posted to a still-loading worker, one frame in
 * flight from the sequential loop.
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
   * Open from the start unless the owner asked otherwise, since the download is
   * the longest part of a first visit. The GPU probe stays outside the gate, so
   * a device that cannot run the detector is turned away without waiting on
   * something the answer does not depend on. Monotonic, so a recycle never waits
   * on it twice.
   */
  const modelLoadAllowed$ = new BehaviorSubject(!deferModelLoad);

  /** Whether this world state wants the pump running. */
  const wantsToRun = (
    isActive: boolean,
    { video, visible, settingsOpen }: EngineInputs,
  ) => isActive && video !== undefined && visible && !settingsOpen;

  /**
   * The derived running state; everything scoped to a running span hangs off it.
   * Cold by design, not an oversight to fix with shareReplay: a fresh
   * combineLatest per subscriber is what hands a late one, like a recycled
   * session's pump, the current value the moment it subscribes.
   */
  const running$ = combineLatest([active$, inputs$]).pipe(
    map(([isActive, inputs]) => wantsToRun(isActive, inputs)),
    distinctUntilChanged(),
  );

  // ---- pump state ----
  /**
   * The most recently posted frame. Worker replies do not echo the frame they
   * answer, so this is how a result learns the geometry to map its boxes
   * against; it stays correct because only one frame is ever in flight. One of
   * the two deliberate pieces of imperative state beside the streams. Never
   * cleared, so a result no post preceded reads it guardedly.
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
  // Recreated on every pump stop, so a resumed session re-earns track
  // confirmation from scratch.
  let tracker = createDetectionTracker();
  const fileProgress = new Map<string, ModelProgress>();
  // Frames the pump completed, gate skips included, read by the crash sentinel
  // against a baseline taken when scanning starts. Skips count because what the
  // sentinel measures is whether the pump kept turning over, which a session
  // parked at a light is doing perfectly well.
  let framesTotal = 0;
  /**
   * The subset of those that actually ran the model. Separate from framesTotal
   * because a session that skipped its way to twenty round trips and one that
   * inferred twenty times are identical in the total and nothing alike.
   */
  let scansTotal = 0;
  /**
   * Worker sessions started, the first included, so recycles are one fewer.
   * Engine-scoped with no per-window baseline, unlike the frame counts, since a
   * recycle bounds native memory across the whole page load.
   */
  let workersStarted = 0;
  /**
   * When the current worker session started; its age says whether a kill landed
   * near the recycle boundary.
   */
  let workerStartedAt = performance.now();
  /**
   * ImageBitmaps this thread owns, tracked at every acquire and release. A count
   * rather than a collection on purpose: a set holding the bitmaps would keep
   * the leak it is meant to detect alive.
   */
  let ownedBitmaps = 0;
  /**
   * The worker's wasm heap as of its last reply carrying one. iOS kills the page
   * over the per-process memory limit without running any JS, so a huge heap at
   * death is only knowable if it was written down while the session was alive.
   */
  let wasmHeapBytes: number | undefined;

  /**
   * Rolling log of what this engine did, oldest first, capped at
   * MAX_SESSION_EVENTS. Engine-scoped rather than per scanning window, so the
   * entries leading up to scanning are still there to read.
   */
  const sessionEvents: SessionEvent[] = [];
  /**
   * Fires when an event lands that should not wait for the next scheduled
   * heartbeat. Only the crash sentinel listens, and only while scanning, so
   * recording outside a scanning window is free.
   */
  const eventBeat$ = new Subject<void>();

  /**
   * Mirror a line to the console for a tethered Web Inspector session, behind
   * the Console diagnostics developer row (a setting, so it survives the
   * crash-reload loop being debugged). Unlike the sentinel log this never leaves
   * the device, so free-text detail is allowed.
   */
  const consoleDiagnostic = (line: string): void => {
    if (!settings$.value.consoleDiagnostics) {
      return;
    }
    console.info(`[dashradar] ${line}`);
  };

  /**
   * Append to the log, and for everything except the per-frame kinds, ask for a
   * heartbeat on the spot. The split is the cost control: scans and skips arrive
   * about once a second and the next beat picks them up anyway, while the rare
   * deliberate moments are exactly the ones whose timing has to survive the page
   * dying right after them.
   */
  const recordEvent = (kind: SessionEventKind, detail?: string): void => {
    sessionEvents.push({ at: Date.now(), kind, detail });
    if (sessionEvents.length > MAX_SESSION_EVENTS) {
      sessionEvents.shift();
    }
    const line = detail ? `${kind} ${detail}` : kind;
    // Per-frame lines carry what a memory investigation reads against the scan
    // count.
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
   * Close a bitmap this thread owns and drop it from the count. Every close of
   * an owned bitmap goes through here so the two cannot drift; the teardown
   * doorman below is the one exception, closing a crop that was never counted.
   */
  const releaseBitmap = (bitmap: ImageBitmap | undefined): void => {
    if (!bitmap) {
      return;
    }
    bitmap.close();
    ownedBitmaps -= 1;
  };
  /**
   * When the model last actually ran, or undefined since the pump last started.
   * The engine's whole side of the scene-change gate, kept here rather than in
   * the worker because the worker cannot see a pause, a resume, or a recycle for
   * what they are.
   */
  let lastScanAt: number | undefined;
  let debug: DebugSnapshot = INITIAL_DEBUG;

  /**
   * Close the published contact's crop and hand back its replacement, the single
   * close site for contact bitmaps. Callers publish the returned value
   * themselves, so the detections handler can batch the swap into a larger patch.
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
  // The telemetry clock, the crash sentinel, and the wake lock each live with
  // scanning as a stream whose teardown is its own release, so a window is a
  // subscribe and an unsubscribe rather than paired start/stop calls.

  /** The telemetry scanning clock, running while subscribed. */
  const scanClock$ = new Observable<never>(() => {
    telemetry.scanningStarted();
    return () => {
      telemetry.scanningStopped();
    };
  });

  /**
   * The crash sentinel: while subscribed, write a timestamped record to
   * localStorage on a cadence so the next launch can tell whether this session
   * ended cleanly. Unsubscribing clears it, so only an OS-level kill mid-scan,
   * where no JS runs, leaves a heartbeat behind to report.
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
        // The writing build, so a report names the deploy that produced the
        // crash rather than the one that happens to read the record.
        release: APP_RELEASE,
        // Read per beat: the view changes under a running session, and the one
        // that explains a kill is whichever was on screen when it happened.
        activeView: inputs$.value.activeView,
        model: reportedModel,
        recycles: Math.max(0, workersStarted - 1),
        workerAgeMs: Math.round(performance.now() - workerStartedAt),
        ownedBitmaps,
        wasmHeapBytes,
        // Copied, not referenced: a shared array would let a later push edit
        // what a caller believes it already wrote down.
        events: [...sessionEvents],
      });
    };
    beat();
    return merge(
      // Re-deferred per repeat so the delay tracks current uptime:
      // heartbeatDelayMs beats every second through startup and every five
      // after, buying resolution on where in startup a crash landed without
      // extra writes across hours of scanning.
      defer(() => timer(heartbeatDelayMs(Date.now() - startedAt))).pipe(
        repeat(),
        tap(beat),
      ),
      // Without this the record trails reality by up to a beat, so a crash
      // moments after switching into the scene reads as a crash in the radar
      // view: the thing these fields exist to show, reported backwards.
      eventBeat$.pipe(tap(beat)),
      // A reload mid-scan can outrun any teardown path, so pagehide is the last
      // synchronous chance to clear the record; a real crash never fires it, so
      // genuine kills still leave it behind. The engine-level pagehide teardown
      // covers the scanning case, this tap covers the error phase, whose
      // activation is already gone while the sentinel keeps watching.
      fromEvent(window, "pagehide").pipe(tap(clearSentinel)),
    );
  }).pipe(ignoreElements(), finalize(clearSentinel));

  // A dash-mounted phone that sleeps mid-drive stops seeing the road with no
  // sign anything changed. Built once per engine rather than per window, so a
  // platform that refuses the lock is reported once for the page load.
  const wakeLock$ = screenWakeLock();

  // Keyed on the published status so no code path can publish a transition
  // these miss. Both end with scanning; a screen held awake in front of an
  // error screen would burn the battery for nothing.
  snapshot$
    .pipe(
      map((s) => s.status === "running"),
      distinctUntilChanged(),
      switchMap((isScanning) =>
        isScanning ? merge(scanClock$, wakeLock$) : EMPTY,
      ),
    )
    .subscribe();

  // The sentinel additionally rides out an error that halted scanning. Torn
  // down with the scanning window, the record died microseconds after the
  // halting error reached its log, so a page killed on the error screen
  // reported nothing: exactly the GPU-death-then-OS-kill chain the record
  // exists to witness. The next activation resets the status, closing this
  // window before a new session writes its own record. An error with no
  // scanning behind it, such as a model that failed to load, never opens it.
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
   * Capture one frame as an ImageBitmap, waiting for a new camera frame first so
   * inference never runs twice on the same one. The `cancelled` flag is what
   * keeps a bitmap resolving after teardown from leaking.
   *
   * A cutout needs the whole video frame, since the contact card is cut from its
   * original pixels; otherwise the crop and scale happen in `createImageBitmap`.
   * The emitted `source` is the video's own size either way, so a result maps
   * its boxes against the frame rather than whatever was captured.
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
   * Whether this frame must be scanned whatever the gate makes of it. Three
   * cases, all of them the engine's to see and none of them the worker's: the
   * gate is off; nothing has been scanned since the pump started, so there is no
   * honest baseline (a resume can sit on any amount of unobserved movement); or
   * skipping has run past SCENE_GATE_MAX_SKIP_MS, the backstop for a
   * miscalibrated threshold or a frozen feed, neither of which can be told apart
   * from a still scene by measuring the frames harder.
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

  // Read off inputs$ rather than from setInputs, so a change is logged once
  // however many times it is pushed, and the value present at subscribe is not
  // logged as if it had just happened.
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
   * deactivate() does, which terminates the worker. It has to be this edge
   * rather than a separate halt signal: activate() early-returns while active$
   * is true, so a halt that left it true could never be restarted.
   */
  const haltForError = () => {
    replaceContact(undefined);
    active$.next(false);
  };

  /**
   * One worker lifetime as an Observable: subscribing spawns it, posts the probe
   * synchronously (the GPU verdict must not wait on anything), and requests the
   * load once both gates are open. Unsubscribing terminates it and abandons a
   * pending load wait.
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
    // Two independent waits, side by side: the owner's go-ahead, and in
    // production a service worker controlling the page so a first visit's fetch
    // lands in the runtime cache (dev has none, so it resolves at once).
    // Unsubscribing is what stops a terminated worker from being posted to.
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
      // A message posted before this teardown can still be dispatched after it,
      // when the subscribers are gone, leaving a crop with no owner. This
      // doorman closes it instead of feeding the subscriber-less subject.
      target.onmessage = (event: MessageEvent) => {
        const message: unknown = event.data;
        if (isWorkerResponse(message) && message.type === "detections") {
          message.crop?.image.close();
        }
      };
      target.terminate();
    };
  });

  /**
   * A reply without a heap size leaves the last reading in place rather than
   * blanking a value the sentinel already had.
   */
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
        // Republished per recycle, so a session that comes back naming nothing
        // is reported that way rather than keeping the last session's words.
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
        // what the last one found, and advancing the tracker would coast the
        // detection toward being dropped.
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
        // A crop arrives transferred, so this thread owns it on arrival.
        // processDetectionResult hands it back as exactly one of contact (kept,
        // released by the next swap) or discardedCrop (released below), so it is
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
        // Raw per-frame output for the detection view, not the coasted set,
        // since the view exists to show what the model saw. Skipped when no
        // frame was recorded, since mapping boxes needs its geometry.
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
        // Closed before the publish: nothing downstream can want a crop that is
        // not in the patch, and this keeps the cleanup from depending on how the
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
          // What the worker's three stages do not account for: postMessage
          // delivery each way plus scheduling. Clamped at 0 to absorb
          // sub-millisecond cross-thread clock noise.
          overheadMs: Math.max(
            0,
            roundTripMs - (preprocessMs + inferenceMs + decodeMs),
          ),
          rawCount: message.detections.length,
          filteredCount: result.detections.length,
          shownCount: result.tracked.length,
          zoom: frame?.zoom ?? ZOOM_OFF,
          // Owned by the pump's retry loop, so a result never erases an
          // in-progress failure streak.
          captureFailures: debug.captureFailures,
          // Carried for one line; paceDelay writes this frame's own decision.
          pacingDelayMs: debug.pacingDelayMs,
          pacingRule: debug.pacingRule,
          // The run of skips is over, but the delta is still reported: readings
          // above the threshold are half of what tuning it needs.
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
        // message.reason is guard-enforced to the WebGPU enum so it may ship;
        // message.detail is whatever the platform said, so it may not.
        recordEvent(
          "error",
          message.reason ? `${message.code} ${message.reason}` : message.code,
        );
        // Out of the shipped log, but the most useful line a tethered console
        // can show for a failure.
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
   * The frame pump for one worker session: runs while running$ is true, starts
   * only after this session reports ready (a still-loading worker silently drops
   * frames), and loops forever. A falling edge unsubscribes mid-anything. The
   * exception is a frame already posted: `awaitingResult` tracks it across the
   * edge so a stop/start that outraces the reply re-primes at depth one instead
   * of putting a second frame in flight.
   */
  const pumpFor = (session: WorkerSession) => {
    let awaitingResult = false;

    /**
     * Every reply that closes out a posted frame. A gate skip counts: treating
     * only results as replies would leave the pump waiting on a frame that was
     * already answered, and the watchdog would recycle a healthy worker.
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
     * The next reply, bounded by the watchdog: a worker silent past
     * WORKER_REPLY_TIMEOUT_MS is wedged in a way no other signal reports
     * (onerror covers crashes, the sentinel covers OS kills), so recycle rather
     * than await forever. The fresh session's ready re-primes the pump.
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
     * Capture a frame, then post it with the reply listener already in place:
     * merge subscribes nextResult$ before the deferred post runs. Otherwise the
     * pump would rest on replies arriving on a later macrotask, and a responder
     * that answered synchronously would emit into nothing and stall it forever.
     */
    const postFrame = (video: HTMLVideoElement) => {
      // One settings read for the whole scan, before the capture. The crop
      // geometry and the zoom the message declares must be the same value or the
      // worker maps boxes out of a crop it was never told about, and only a
      // single read guarantees that across the capture's await.
      const { zoom, includeContact, confidenceThreshold, sceneGate } =
        settings$.value;
      return captureFrame(video, includeContact ? undefined : zoom).pipe(
        switchMap(({ frame, captureMs, source }) =>
          merge(
            nextResult$,
            defer(() => {
              // The video's size, not the bitmap's: a pre-cropped capture is the
              // model's input, while everything downstream of a result works
              // against the frame it came from.
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
              // Transferred, not closed: the bitmap is the worker's now.
              ownedBitmaps -= 1;
              return EMPTY;
            }),
          ),
        ),
      );
    };

    /**
     * One pump iteration: capture and post, await the reply, then either pace
     * the next capture or complete the session for recycle. A frame still
     * outstanding from before an interruption skips straight to the awaiting.
     */
    const scanOnce = () =>
      defer(() => {
        if (awaitingResult) {
          return nextResult$;
        }
        const video = inputs$.value.video;
        // running$ implies a video is attached, so this branch should be
        // unreachable; the timer stops repeat() from spinning synchronously if
        // that coupling ever breaks.
        return video
          ? postFrame(video)
          : timer(FRAME_RETRY_MS).pipe(ignoreElements());
      }).pipe(
        switchMap(() => {
          // Recycle at this result boundary, where nothing is in flight. Status
          // stays "running" so one-shot analytics gates never re-fire; the new
          // session's ready re-primes the pump.
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
        // A failed capture retries forever, the expected cause being a video
        // element with no frame data yet, which resolves itself moments later.
        // Deliberately quiet beyond the debug counter, so a persistent failure
        // shows up as a climbing captureFailures readout rather than an alert.
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
              // Unbounded on purpose: the load watchdog recycles the session out
              // from under this wait if ready never comes.
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
   * because it only arms once a frame is posted. Until ready, some message must
   * arrive every WORKER_LOAD_TIMEOUT_MS. An inactivity bound rather than a load
   * budget: a load can be legitimately slow but never legitimately silent.
   *
   * The watch starts when the download is allowed rather than at creation, since
   * a load the owner is deliberately holding back would otherwise recycle a
   * healthy worker every minute.
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

  // One activation's worker chain: sessions repeat on recycle, and flipping
  // active$ off unsubscribes the current session, terminating its worker. The
  // merge order is load-bearing: the message handler subscribes before the pump,
  // so a result is fully processed before the pump computes pacing from it.
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

  // running$'s sources emit at subscribe, so this fires immediately with the
  // initial false; the falling-edge actions are all no-ops against fresh state,
  // so no skip is needed.
  running$.subscribe((isRunning) => {
    if (isRunning) {
      if (snapshot$.value.status === "ready") {
        setStatus("running");
      }
      return;
    }
    // A pause of any length can sit between these two frames, so a resumed
    // session re-earns track confirmation and scans its first frame rather than
    // measuring it against a baseline from before the pause.
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
    // A fresh activation behaves like a fresh mount: published state and
    // per-load state reset before the new worker reports anything.
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
  // synchronous chance to terminate the worker. This is for memory, not
  // tidiness: WebKit reuses one WebContent process across same-site reloads and
  // reclaims a departed page's wasm memory, ORT session, and GPU handles lazily
  // at best, so each reload otherwise stacks residue onto the process until iOS
  // kills it at the per-process cap. pagehide also fires into the bfcache, so
  // the switchMap arms a one-shot pageshow wait to reactivate on a restore,
  // standing down if a new mount already activated the engine. An engine that
  // was not active is left alone by both halves.
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
      // Skip the BehaviorSubject's replay: the contract is notify-on-change, and
      // useSyncExternalStore reads the current value itself via getSnapshot.
      const subscription = snapshot$.pipe(skip(1)).subscribe(onChange);
      return () => {
        subscription.unsubscribe();
      };
    },
    setInputs: (next) => {
      inputs$.next({ ...inputs$.value, ...next });
    },
    updateSettings: (next) => {
      // Retired at the settings edge because the worker stops producing crops
      // the moment the setting lands, so no later result would swap the pinned
      // bitmap out and it would stay open for the rest of the session.
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
