import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_RELEASE } from "@/lib/appRelease";
import {
  HEARTBEAT_INTERVAL_MS,
  MAX_SESSION_EVENTS,
  SENTINEL_STORAGE_KEY,
} from "@/lib/crashSentinel";
import { CONFIDENCE_THRESHOLD } from "@/lib/detection";
import { DEFAULT_MODEL } from "@/lib/detectionModels";
import type { DetectionTelemetry } from "@/lib/detectionTelemetry";
import { SIGNAL_FLOOR } from "@/lib/radarSignal";
import { INPUT_SIZE, ZOOM_2X, ZOOM_OFF } from "@/workers/detection/consts";
import type { WorkerRequest, WorkerResponse } from "@/workers/detection/types";
import { createDetectionEngine, pacingDelay } from "./index";
import {
  FRAME_RETRY_MS,
  MAX_FRAME_INTERVAL_MS,
  MIN_FRAME_INTERVAL_MS,
  SCENE_GATE_MAX_SKIP_MS,
  WORKER_LOAD_TIMEOUT_MS,
  WORKER_RECYCLE_AFTER_MS,
  WORKER_REPLY_TIMEOUT_MS,
} from "./consts";
import type {
  DetectionEngine,
  DetectionWorkerLike,
  EngineSettings,
  IdentifiedDetections,
  RawDetections,
} from "./types";

/**
 * The engine is framework-free, so these drive it directly: build one on a
 * fake worker, push the world state in, and read snapshots back. Nothing here
 * renders, which is the point. React's own job (mirroring snapshots, turning
 * document events into inputs) is tested against the provider instead.
 */
class FakeWorker implements DetectionWorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: WorkerRequest[] = [];

  terminate = vi.fn();

  postMessage(message: WorkerRequest) {
    this.posted.push(message);
  }

  emit(message: WorkerResponse) {
    this.onmessage?.(new MessageEvent("message", { data: message }));
  }
}

/**
 * A video element that reports an intrinsic size, the way a playing camera
 * stream does. The engine reads these to decide the region it captures and to
 * tell a result which frame its boxes belong to, so jsdom's zero-sized default
 * would leave both untested.
 */
const fakeVideo = (width = 1280, height = 720): HTMLVideoElement => {
  const video = document.createElement("video");
  Object.defineProperty(video, "videoWidth", { value: width });
  Object.defineProperty(video, "videoHeight", { value: height });
  return video;
};

const fakeBitmap = () =>
  ({ width: 1280, height: 720, close: () => {} }) as unknown as ImageBitmap;

const fakeTelemetry = (): DetectionTelemetry => ({
  modelLoadStart: vi.fn(),
  modelDownloaded: vi.fn(),
  modelReady: vi.fn(),
  result: vi.fn(),
  error: vi.fn(),
  workerHung: vi.fn(),
  scanningStarted: vi.fn(),
  scanningStopped: vi.fn(),
  reportScanSession: vi.fn(),
});

/** Engines built by a test, deactivated after it so nothing outlives it. */
const built: DetectionEngine[] = [];

/**
 * An activated engine on fake workers. `workers` collects every one it spawns,
 * so a recycle is observable; `worker` is the first, which is all a test that
 * never recycles needs.
 */
const testEngine = ({ deferModelLoad = false, model = DEFAULT_MODEL } = {}) => {
  const workers: FakeWorker[] = [];
  const telemetry = fakeTelemetry();
  const engine = createDetectionEngine({
    model,
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    telemetry,
    deferModelLoad,
  });
  built.push(engine);
  engine.activate();
  return { engine, workers, worker: workers[0], telemetry };
};

/** The engine's own starting settings, for a test that changes just one. */
const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  includeContact: false,
  throttled: true,
  sceneGate: true,
  zoom: ZOOM_OFF,
  confidenceThreshold: CONFIDENCE_THRESHOLD,
  consoleDiagnostics: false,
};

/**
 * A video element whose requestVideoFrameCallback is under test control:
 * callbacks queue up until presentFrame() fires them, simulating the camera
 * presenting a new frame. jsdom's video element has no rVFC of its own, so
 * assigning one exercises the pump's wait-for-new-frame path.
 */
const videoWithControlledFrames = () => {
  const callbacks: VideoFrameRequestCallback[] = [];
  const video = fakeVideo();
  video.requestVideoFrameCallback = (callback) => {
    callbacks.push(callback);
    return callbacks.length;
  };
  const presentFrame = () => {
    for (const callback of callbacks.splice(0)) {
      callback(performance.now(), {
        presentationTime: 0,
        expectedDisplayTime: 0,
        width: 512,
        height: 512,
        mediaTime: 0,
        presentedFrames: 1,
      });
    }
  };
  return { video, presentFrame };
};

/** Detect requests a worker has been handed. */
const detectCount = (worker: FakeWorker) =>
  worker.posted.filter((message) => message.type === "detect").length;

/** The load request a worker has been sent, if it has been sent one. */
const loadMessage = (worker: FakeWorker) =>
  worker.posted.find((message) => message.type === "load");

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(() => Promise.resolve(fakeBitmap())),
  );
});

afterEach(() => {
  built.splice(0).forEach((engine) => engine.deactivate());
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "wakeLock");
  window.localStorage.clear();
  window.sessionStorage.clear();
});

/**
 * Share of wall time the GPU spends busy for a given round trip: the work
 * itself over the work plus the idle that follows it. This is what heats a
 * dash-mounted phone, so it is what these tests assert on rather than the
 * delay in isolation.
 */
const dutyCycle = (roundTripMs: number): number =>
  roundTripMs / (roundTripMs + pacingDelay(roundTripMs).delayMs);

describe("pacingDelay", () => {
  it("keeps a fast device's captures a full scan interval apart", () => {
    // The floor governs anything quick enough that resting the round trip
    // would return sooner than the interval allows.
    const roundTripMs = 120;
    const { delayMs, rule } = pacingDelay(roundTripMs);
    expect(rule).toBe("floor");
    expect(roundTripMs + delayMs).toBe(MIN_FRAME_INTERVAL_MS);
  });

  it("lightens the load as a device slows, rather than holding it steady", () => {
    // The regression this guards: a rest proportional to a fixed multiple of
    // the round trip gives a throttling phone more idle in absolute terms but
    // the same share of busy time, so the pacing never backs off the load that
    // caused the throttling. Every step deeper into the throttled band must
    // buy a strictly smaller share.
    const throttling = [600, 800, 1_000, 1_200, 1_400];
    const duties = throttling.map(dutyCycle);
    for (let i = 1; i < duties.length; i += 1) {
      expect(duties[i]).toBeLessThan(duties[i - 1]);
    }
  });

  it("never lets the GPU run busier than half the time", () => {
    for (let roundTripMs = 10; roundTripMs <= 4_000; roundTripMs += 10) {
      expect(dutyCycle(roundTripMs)).toBeLessThanOrEqual(0.5);
    }
  });

  it("keeps scanning often enough to be useful on the slowest devices", () => {
    // The ramp trades scan rate for heat, and unbounded that trade lands on a
    // detector too slow to catch what the car drives past.
    for (const roundTripMs of [2_000, 5_000, 20_000]) {
      expect(pacingDelay(roundTripMs).delayMs).toBeLessThanOrEqual(
        MAX_FRAME_INTERVAL_MS,
      );
    }
    expect(pacingDelay(20_000).rule).toBe("capped");
  });

  it("never scans more often as the round trip grows", () => {
    // The interval between captures, not the delay: under the floor rule a
    // longer round trip eats into the delay while the interval holds steady,
    // and only an interval that shortened would mean a slower device scanning
    // more often than a faster one.
    let previous = 0;
    for (let roundTripMs = 0; roundTripMs <= 3_000; roundTripMs += 25) {
      const interval = roundTripMs + pacingDelay(roundTripMs).delayMs;
      expect(interval).toBeGreaterThanOrEqual(previous);
      previous = interval;
    }
  });
});

describe("screen wake lock", () => {
  const stubWakeLock = () => {
    const sentinel = { release: vi.fn(() => Promise.resolve()) };
    const request = vi.fn(() => Promise.resolve(sentinel));
    Object.defineProperty(navigator, "wakeLock", {
      value: { request },
      configurable: true,
    });
    return { request, sentinel };
  };

  it("holds a wake lock only while scanning", async () => {
    const { request, sentinel } = stubWakeLock();
    const { engine, worker } = testEngine();
    worker.emit({ type: "ready" });
    // Loaded but with no video attached: nothing is scanning, so the screen is
    // free to sleep.
    expect(request).not.toHaveBeenCalled();
    engine.setInputs({ video: fakeVideo() });
    expect(request).toHaveBeenCalledWith("screen");
    await vi.advanceTimersByTimeAsync(0);
    engine.setInputs({ video: undefined });
    expect(sentinel.release).toHaveBeenCalled();
  });
});

describe("crash sentinel heartbeat", () => {
  const readSentinel = (): Record<string, unknown> | null => {
    const raw = window.localStorage.getItem(SENTINEL_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  };

  /** A loaded engine with the pump running. */
  const scanning = () => {
    const built = testEngine();
    built.worker.emit({ type: "ready" });
    built.engine.setInputs({ video: fakeVideo() });
    return built;
  };

  const emptyResult = {
    type: "detections" as const,
    detections: [],
    timing: { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 },
  };

  it("writes a sentinel record once detection starts running", () => {
    const { engine, worker } = testEngine();
    worker.emit({ type: "ready" });
    expect(readSentinel()).toBeNull();
    engine.setInputs({ video: fakeVideo() });
    expect(readSentinel()).toMatchObject({
      framesProcessed: 0,
      release: APP_RELEASE,
    });
  });

  it("stamps the view and the model, so a crash report can name both", () => {
    const { engine } = scanning();
    expect(readSentinel()).toMatchObject({
      activeView: "radar",
      model: DEFAULT_MODEL.slug,
    });
    engine.setInputs({ activeView: "scene" });
    expect(readSentinel()).toMatchObject({ activeView: "scene" });
  });

  it("names an added model generically, never by its pasted address", () => {
    const { engine, worker } = testEngine({
      model: {
        ...DEFAULT_MODEL,
        id: "added-1",
        slug: "private-host-name",
        weightsUrl: "https://internal.example.com/secret/model.onnx",
      },
    });
    worker.emit({ type: "ready" });
    engine.setInputs({ video: fakeVideo() });
    expect(readSentinel()).toMatchObject({ model: "custom" });
  });

  it("clears the sentinel record when the pump leaves the running state", () => {
    const { engine } = scanning();
    expect(readSentinel()).not.toBeNull();
    engine.setInputs({ video: undefined });
    expect(readSentinel()).toBeNull();
  });

  it("clears the sentinel record on pagehide so a reload is not read as a crash", () => {
    scanning();
    expect(readSentinel()).not.toBeNull();
    window.dispatchEvent(new Event("pagehide"));
    expect(readSentinel()).toBeNull();
  });

  // Pagehide now ends the whole activation (the worker's memory is handed
  // back before the page departs), so coverage across a bfcache round trip is
  // restored by reactivation rather than by a heartbeat that outlived the
  // session.
  it("re-arms crash coverage through reactivation after a bfcache round trip", async () => {
    const { workers } = scanning();
    window.dispatchEvent(new Event("pagehide"));
    expect(readSentinel()).toBeNull();
    // The heartbeat died with the session, so nothing rewrites the record.
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(readSentinel()).toBeNull();
    // The bfcache restore reactivates the engine; once its fresh worker is
    // ready, scanning resumes and a new record is written.
    const pageshow = new Event("pageshow");
    Object.defineProperty(pageshow, "persisted", { value: true });
    window.dispatchEvent(pageshow);
    workers.at(-1)?.emit({ type: "ready" });
    expect(readSentinel()).not.toBeNull();
  });

  it("clears the sentinel record when the engine is deactivated", () => {
    const { engine } = scanning();
    expect(readSentinel()).not.toBeNull();
    engine.deactivate();
    expect(readSentinel()).toBeNull();
  });

  it("does not write a sentinel record while only ready (not running)", () => {
    const { worker } = testEngine();
    worker.emit({ type: "ready" });
    expect(readSentinel()).toBeNull();
  });

  it("grows framesProcessed as detections results arrive between heartbeats", async () => {
    const { worker } = scanning();
    // The immediate heartbeat on entering "running" is written before any
    // detections result, so framesProcessed starts at 0.
    expect(readSentinel()).toMatchObject({ framesProcessed: 0 });
    await vi.advanceTimersByTimeAsync(0);
    worker.emit(emptyResult);
    // The next interval tick picks up the frame counted by the result above.
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(readSentinel()).toMatchObject({ framesProcessed: 1 });
  });

  it("counts a gated skip as a round trip but not as a scan", async () => {
    const { worker } = scanning();
    await vi.advanceTimersByTimeAsync(0);
    worker.emit({ type: "scan-skipped", gateMs: 1, delta: 0 });
    worker.emit(emptyResult);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    // Two round trips, one of which the gate answered without the model. Read
    // as a single total, this session looks twice as busy as it was.
    expect(readSentinel()).toMatchObject({
      framesProcessed: 2,
      scansProcessed: 1,
    });
  });

  // Both counts are engine-scoped totals read against a baseline taken when
  // scanning starts. Without the baseline a session that paused once would
  // report every frame the whole drive had run as its own.
  it("counts from zero again after a stop and restart, not from the drive's total", async () => {
    const { engine, worker } = scanning();
    await vi.advanceTimersByTimeAsync(0);
    worker.emit({ type: "scan-skipped", gateMs: 1, delta: 0 });
    worker.emit(emptyResult);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(readSentinel()).toMatchObject({
      framesProcessed: 2,
      scansProcessed: 1,
    });
    engine.setInputs({ video: undefined });
    engine.setInputs({ video: fakeVideo() });
    expect(readSentinel()).toMatchObject({
      framesProcessed: 0,
      scansProcessed: 0,
    });
  });

  // The record used to be torn down with the scanning window, which erased
  // the log's last entry (the very error that explains the halt) microseconds
  // after the beat wrote it, so a page killed on the error screen reported
  // nothing at the next launch.
  it("keeps the record, error and reason logged, when a worker error halts scanning", async () => {
    const { worker } = scanning();
    await vi.advanceTimersByTimeAsync(0);
    worker.emit({
      type: "worker-error",
      code: "GPU_DEVICE_LOST",
      reason: "unknown",
      detail: "unknown: the GPU process exited",
    });
    const record = readSentinel();
    expect(record).not.toBeNull();
    const events = record?.events as { kind: string; detail?: string }[];
    // The bounded reason, never the free-text detail: the log ships.
    expect(events.at(-1)).toEqual({
      at: expect.any(Number),
      kind: "error",
      detail: "GPU_DEVICE_LOST unknown",
    });
  });

  it("keeps beating on the error screen, so a kill there still classifies by a fresh gap", async () => {
    const { worker } = scanning();
    worker.emit({ type: "worker-error", code: "GPU_DEVICE_LOST" });
    const before = (readSentinel() as { lastBeatAt: number }).lastBeatAt;
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 2);
    const after = (readSentinel() as { lastBeatAt: number }).lastBeatAt;
    expect(after).toBeGreaterThan(before);
  });

  it("still clears the surviving record on pagehide", () => {
    const { worker } = scanning();
    worker.emit({ type: "worker-error", code: "GPU_DEVICE_LOST" });
    expect(readSentinel()).not.toBeNull();
    window.dispatchEvent(new Event("pagehide"));
    expect(readSentinel()).toBeNull();
  });

  it("clears the surviving record when a new activation starts", () => {
    const { engine, worker } = scanning();
    worker.emit({ type: "worker-error", code: "GPU_DEVICE_LOST" });
    expect(readSentinel()).not.toBeNull();
    engine.activate();
    expect(readSentinel()).toBeNull();
  });

  // Guard for the new branch: an error with no scanning window behind it has
  // no record to keep, so surviving must not mean creating.
  it("leaves no record when the error lands before scanning ever ran", () => {
    const { worker } = testEngine();
    worker.emit({ type: "ready" });
    worker.emit({ type: "worker-error", code: "MODEL_LOAD_FAILED" });
    expect(readSentinel()).toBeNull();
  });

  it("logs a worker that died without a message in the surviving record", () => {
    const { worker } = scanning();
    worker.onerror?.(new ErrorEvent("error"));
    const record = readSentinel();
    expect(record).not.toBeNull();
    const events = record?.events as { kind: string; detail?: string }[];
    expect(events.at(-1)).toMatchObject({
      kind: "error",
      detail: "WORKER_CRASHED",
    });
  });

  it("reports the wasm heap size the worker last carried on a reply", async () => {
    const { worker } = scanning();
    await vi.advanceTimersByTimeAsync(0);
    worker.emit({ ...emptyResult, wasmHeapBytes: 123_456_789 });
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(readSentinel()).toMatchObject({ wasmHeapBytes: 123_456_789 });
    // A reply without the field keeps the last reading rather than blanking
    // a value the sentinel already had.
    worker.emit(emptyResult);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(readSentinel()).toMatchObject({ wasmHeapBytes: 123_456_789 });
  });

  // The count is only worth reading if it comes back down: a number that only
  // ever climbs would report every healthy session as leaking.
  it("counts the bitmaps this thread owns, and lets them go again", async () => {
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    const { engine, worker } = scanning();
    engine.updateSettings({
      ...DEFAULT_ENGINE_SETTINGS,
      includeContact: true,
    });
    const timing = { preprocessMs: 1, inferenceMs: 2, decodeMs: 3 };
    const detection = {
      label: "police",
      score: 0.9,
      box: { xmin: 0.15, ymin: 0.4, xmax: 0.25, ymax: 0.6 },
    };
    const emitCrop = (detectionIndex: number) => {
      worker.emit({
        type: "detections",
        detections: [detection],
        timing,
        crop: {
          image: new FakeImageBitmap() as unknown as ImageBitmap,
          detectionIndex,
        },
      });
    };

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(readSentinel()).toMatchObject({ ownedBitmaps: 0 });

    // A crop whose detection fails validation is released as it arrives.
    emitCrop(5);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(readSentinel()).toMatchObject({ ownedBitmaps: 0 });

    // A crop kept as the contact is owned until the next one replaces it, so
    // three in a row rest at one rather than at three.
    emitCrop(0);
    emitCrop(0);
    emitCrop(0);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(readSentinel()).toMatchObject({ ownedBitmaps: 1 });
  });

  it("counts a rebuilt worker, so a kill near a recycle is not read as a steady-state one", async () => {
    const { workers } = scanning();
    expect(readSentinel()).toMatchObject({ recycles: 0 });
    expect(readSentinel()?.workerAgeMs).toEqual(expect.any(Number));
    // A worker that never answers its posted frame is recycled by the reply
    // watchdog, which is the cheapest second session to get here.
    await vi.advanceTimersByTimeAsync(WORKER_REPLY_TIMEOUT_MS);
    expect(workers).toHaveLength(2);
    workers[1].emit({ type: "ready" });
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(readSentinel()).toMatchObject({ recycles: 1 });
  });

  // The whole point of the split: a notable moment has to be on disk before
  // the page dies, while a once-a-second scan must not buy a write of its own.
  it("writes a notable event through at once and lets scans wait for the next beat", async () => {
    const { engine, worker } = scanning();
    await vi.advanceTimersByTimeAsync(0);
    worker.emit(emptyResult);
    expect(readSentinel()?.events).not.toContainEqual(
      expect.objectContaining({ kind: "scan" }),
    );
    engine.setInputs({ activeView: "scene" });
    expect(readSentinel()?.events).toContainEqual(
      expect.objectContaining({ kind: "scan" }),
    );
    expect(readSentinel()?.events).toContainEqual(
      expect.objectContaining({ kind: "view", detail: "scene" }),
    );
  });

  it("keeps the log bounded and oldest first, so a drive cannot grow the record", async () => {
    const { engine, worker } = scanning();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < MAX_SESSION_EVENTS + 5; i += 1) {
      worker.emit(emptyResult);
    }
    engine.setInputs({ activeView: "scene" });
    const events = readSentinel()?.events as { kind: string }[];
    expect(events).toHaveLength(MAX_SESSION_EVENTS);
    // Newest last, and the load this session opened with has aged out.
    expect(events[events.length - 1]).toMatchObject({ kind: "view" });
    expect(events.some(({ kind }) => kind === "load")).toBe(false);
  });

  it("does not reset startedAt or framesProcessed when a recycled worker re-reports its probe", async () => {
    const { worker } = scanning();
    // Capture the initial startedAt written when the running span began.
    const startedAt = readSentinel()?.startedAt;
    expect(startedAt).toEqual(expect.any(Number));
    // A frame result grows framesProcessed, and time advances so a restart of
    // the heartbeat would capture a later startedAt.
    await vi.advanceTimersByTimeAsync(0);
    worker.emit(emptyResult);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(readSentinel()).toMatchObject({ startedAt, framesProcessed: 1 });
    // A recycled worker re-reports its backend probe (fresh object identity).
    // The heartbeat must not tear down and restart: startedAt and the frames
    // baseline must survive.
    worker.emit({
      type: "backend-probe",
      probe: { graphCapture: false, crossOriginIsolated: true, threads: 4 },
    });
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(readSentinel()).toMatchObject({ startedAt, framesProcessed: 1 });
  });
});

describe("worker recycle", () => {
  const emptyResult = {
    type: "detections" as const,
    detections: [],
    timing: { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 },
  };

  /**
   * Recycling is keyed on a worker's age, so these tests drive the clock by
   * hand: `setNow` moves it, and a worker is born at 0.
   */
  const controlledClock = () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    return (value: number) => {
      now = value;
    };
  };

  /** An engine whose first worker is loaded and pumping. */
  const scanning = async () => {
    const built = testEngine();
    built.workers[0].emit({ type: "ready" });
    built.engine.setInputs({ video: fakeVideo() });
    await vi.advanceTimersByTimeAsync(0);
    return built;
  };

  it("does not recycle a worker younger than the threshold", async () => {
    const setNow = controlledClock();
    const { engine, workers } = testEngine();
    workers[0].emit({ type: "ready" });
    engine.setInputs({ video: fakeVideo() });
    // Age the worker to just under the threshold before the first frame posts,
    // so its round trip stays near zero (age is measured from creation at 0).
    setNow(WORKER_RECYCLE_AFTER_MS - 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(detectCount(workers[0])).toBe(1);
    // The result lands with the worker still under the recycle age.
    workers[0].emit(emptyResult);
    expect(workers).toHaveLength(1);
    expect(workers[0].terminate).not.toHaveBeenCalled();
    // The same worker is re-primed by the pacing timer, not recycled.
    await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
    expect(detectCount(workers[0])).toBe(2);
  });

  it("recycles a worker past the threshold and resumes the pump", async () => {
    const setNow = controlledClock();
    const { engine, workers } = await scanning();
    expect(detectCount(workers[0])).toBe(1);
    // The worker crosses the recycle age; its next result triggers a recycle.
    setNow(WORKER_RECYCLE_AFTER_MS);
    workers[0].emit(emptyResult);
    // The old worker is terminated and a fresh one created and told to load.
    expect(workers).toHaveLength(2);
    expect(workers[0].terminate).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(workers[1].posted).toEqual([
      { type: "probe" },
      { type: "load", model: DEFAULT_MODEL },
    ]);
    // The old worker was mid-run at recycle, so no paced frame was scheduled on
    // it: the pump only resumes once the new worker reports ready.
    expect(detectCount(workers[1])).toBe(0);
    workers[1].emit({ type: "ready" });
    await vi.advanceTimersByTimeAsync(0);
    // The running state never lapsed, so the new worker's ready re-primes it.
    expect(engine.getSnapshot().status).toBe("running");
    expect(detectCount(workers[1])).toBe(1);
  });

  it("recycles a worker whose reply never arrives", async () => {
    const { workers, telemetry } = await scanning();
    expect(detectCount(workers[0])).toBe(1);
    // The worker never answers: no result, no worker-error, no crash. The
    // reply watchdog is the only signal left, and it recycles the worker.
    await vi.advanceTimersByTimeAsync(WORKER_REPLY_TIMEOUT_MS);
    expect(workers).toHaveLength(2);
    expect(workers[0].terminate).toHaveBeenCalled();
    expect(telemetry.workerHung).toHaveBeenCalled();
    // The fresh worker's ready re-primes the pump and scanning resumes.
    workers[1].emit({ type: "ready" });
    await vi.advanceTimersByTimeAsync(0);
    expect(detectCount(workers[1])).toBe(1);
    // A second hang recycles again (the report is gated downstream, in the
    // telemetry sink, so the engine keeps reporting each one).
    await vi.advanceTimersByTimeAsync(WORKER_REPLY_TIMEOUT_MS);
    expect(workers).toHaveLength(3);
  });

  it("recycles a worker whose model load goes silent", async () => {
    const { engine, workers, telemetry } = testEngine();
    // The worker posts nothing at all: no probe verdict, no load progress, no
    // ready, no worker-error. The reply watchdog cannot see this (no frame is
    // ever posted to a session that never loads), so without its own bound
    // the pump would wait on this worker's ready for the rest of the drive.
    await vi.advanceTimersByTimeAsync(WORKER_LOAD_TIMEOUT_MS);
    expect(workers).toHaveLength(2);
    expect(workers[0].terminate).toHaveBeenCalled();
    expect(telemetry.workerHung).toHaveBeenCalled();
    // The fresh worker loads normally and the app recovers.
    workers[1].emit({ type: "ready" });
    expect(engine.getSnapshot().status).toBe("ready");
  });

  it("does not recycle a worker whose download is being held back", async () => {
    // Guard for the watchdog's starting line. A held-back load is silent by
    // design, and a watch armed at session creation would read that as a wedged
    // worker and recycle a healthy one every minute for as long as the intro is
    // up, spawning workers nobody asked for.
    const { engine, workers } = testEngine({ deferModelLoad: true });
    await vi.advanceTimersByTimeAsync(WORKER_LOAD_TIMEOUT_MS * 3);
    expect(workers).toHaveLength(1);
    expect(workers[0].terminate).not.toHaveBeenCalled();
    // Allowing the download arms the watch: the load goes out, and the same
    // silence that was fine a moment ago is now a wedged load.
    engine.allowModelLoad();
    await vi.advanceTimersByTimeAsync(0);
    expect(loadMessage(workers[0])).toBeDefined();
    await vi.advanceTimersByTimeAsync(WORKER_LOAD_TIMEOUT_MS);
    expect(workers).toHaveLength(2);
    expect(workers[0].terminate).toHaveBeenCalled();
  });

  it("does not recycle a load that is still reporting progress", async () => {
    // The watchdog bounds silence, not load time. A slow network streams the
    // weights far past the timeout in total but posts a progress message with
    // every chunk; recycling that load would restart the download from
    // scratch, forever.
    const { workers } = testEngine();
    for (let chunk = 0; chunk < 3; chunk += 1) {
      await vi.advanceTimersByTimeAsync(WORKER_LOAD_TIMEOUT_MS - 1_000);
      workers[0].emit({
        type: "model-progress",
        progress: { file: "model.onnx", loaded: chunk + 1, total: 4 },
      });
    }
    expect(workers).toHaveLength(1);
    workers[0].emit({ type: "ready" });
    // Ready ends the watch: silence from here is normal idling, owned by the
    // reply watchdog once a frame is posted.
    await vi.advanceTimersByTimeAsync(WORKER_LOAD_TIMEOUT_MS * 2);
    expect(workers).toHaveLength(1);
    expect(workers[0].terminate).not.toHaveBeenCalled();
  });

  it("leaves the pump stopped when a stop lands between recycle and ready", async () => {
    const setNow = controlledClock();
    const { engine, workers } = await scanning();
    expect(detectCount(workers[0])).toBe(1);
    setNow(WORKER_RECYCLE_AFTER_MS);
    workers[0].emit(emptyResult);
    expect(workers).toHaveLength(2);
    // The video detaches before the recycled worker finishes loading.
    engine.setInputs({ video: undefined });
    workers[1].emit({ type: "ready" });
    await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
    // Nothing wants the pump running, so the new worker's ready must not
    // re-prime it.
    expect(detectCount(workers[1])).toBe(0);
  });

  it("re-primes exactly once when a stop then a start land during the recycle-load window", async () => {
    const setNow = controlledClock();
    const { engine, workers } = await scanning();
    expect(detectCount(workers[0])).toBe(1);
    // The worker crosses the recycle age; its next result recycles it, leaving
    // a fresh worker that has not reported ready yet.
    setNow(WORKER_RECYCLE_AFTER_MS);
    workers[0].emit(emptyResult);
    expect(workers).toHaveLength(2);
    // A stop and a start both land inside the recycle-load window (settings
    // opening and closing, or a visibility bounce). The still-loading worker
    // must not receive a frame: it would silently drop it and strand the
    // in-flight count.
    engine.setInputs({ video: undefined });
    engine.setInputs({ video: fakeVideo() });
    await vi.advanceTimersByTimeAsync(0);
    expect(detectCount(workers[1])).toBe(0);
    // The new worker finishes loading: its ready re-primes the pump exactly
    // once (not zero: the pump would otherwise be dead; not two).
    workers[1].emit({ type: "ready" });
    await vi.advanceTimersByTimeAsync(0);
    expect(detectCount(workers[1])).toBe(1);
  });
});

/** Minimal stand-in for ImageBitmap, which jsdom does not provide. */
class FakeImageBitmap {
  width = 320;
  height = 240;
  close = vi.fn();
}

describe("contact", () => {
  const timing = { preprocessMs: 1, inferenceMs: 2, decodeMs: 3 };
  const policeDetection = (score: number, xmin: number, xmax: number) => ({
    label: "police",
    score,
    box: { xmin, ymin: 0.4, xmax, ymax: 0.6 },
  });

  /** An engine asked for cutouts, which is off by default. */
  const withContact = ({ includeContact = true } = {}) => {
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    const built = testEngine();
    built.engine.updateSettings({ ...DEFAULT_ENGINE_SETTINGS, includeContact });
    return built;
  };

  const contact = (engine: DetectionEngine) => engine.getSnapshot().contact;

  it("exposes a contact built from the cropped detection", () => {
    const { engine, worker } = withContact();
    // A score halfway up the [SIGNAL_FLOOR, 1] band remaps to 0.5 signal;
    // center-x 0.2 is left.
    const midBand = SIGNAL_FLOOR + (1 - SIGNAL_FLOOR) / 2;
    worker.emit({
      type: "detections",
      detections: [policeDetection(midBand, 0.15, 0.25)],
      timing,
      crop: {
        image: new FakeImageBitmap() as unknown as ImageBitmap,
        detectionIndex: 0,
      },
    });
    expect(contact(engine)).toMatchObject({
      direction: "left",
      score: midBand,
    });
    expect(contact(engine)?.signal).toBeCloseTo(0.5);
  });

  it("closes the previous contact's bitmap when a new crop arrives", () => {
    const { engine, worker } = withContact();
    const first = new FakeImageBitmap();
    worker.emit({
      type: "detections",
      detections: [policeDetection(0.85, 0.15, 0.25)],
      timing,
      crop: { image: first as unknown as ImageBitmap, detectionIndex: 0 },
    });
    worker.emit({
      type: "detections",
      detections: [policeDetection(0.9, 0.45, 0.55)],
      timing,
      crop: {
        image: new FakeImageBitmap() as unknown as ImageBitmap,
        detectionIndex: 0,
      },
    });
    expect(first.close).toHaveBeenCalled();
    expect(contact(engine)?.direction).toBe("ahead");
  });

  it("keeps the last contact through detection-free frames", () => {
    const { engine, worker } = withContact();
    worker.emit({
      type: "detections",
      detections: [policeDetection(0.85, 0.15, 0.25)],
      timing,
      crop: {
        image: new FakeImageBitmap() as unknown as ImageBitmap,
        detectionIndex: 0,
      },
    });
    worker.emit({ type: "detections", detections: [], timing });
    expect(contact(engine)?.direction).toBe("left");
  });

  it("discards a crop whose indexed detection fails validation", () => {
    const { engine, worker } = withContact();
    const orphan = new FakeImageBitmap();
    worker.emit({
      type: "detections",
      detections: [policeDetection(0.85, 0.15, 0.25)],
      timing,
      crop: { image: orphan as unknown as ImageBitmap, detectionIndex: 5 },
    });
    expect(orphan.close).toHaveBeenCalled();
    expect(contact(engine)).toBeUndefined();
  });

  it("clears the contact on a worker error", () => {
    const { engine, worker } = withContact();
    const image = new FakeImageBitmap();
    worker.emit({
      type: "detections",
      detections: [policeDetection(0.85, 0.15, 0.25)],
      timing,
      crop: { image: image as unknown as ImageBitmap, detectionIndex: 0 },
    });
    worker.emit({ type: "worker-error", code: "INFERENCE_FAILED" });
    expect(image.close).toHaveBeenCalled();
    expect(contact(engine)).toBeUndefined();
  });

  it("closes the contact bitmap when the engine is deactivated", () => {
    const { engine, worker } = withContact();
    const image = new FakeImageBitmap();
    worker.emit({
      type: "detections",
      detections: [policeDetection(0.85, 0.15, 0.25)],
      timing,
      crop: { image: image as unknown as ImageBitmap, detectionIndex: 0 },
    });
    engine.deactivate();
    expect(image.close).toHaveBeenCalled();
  });

  // A message posted before teardown can be dispatched after it, when the
  // session's subscribers are gone; without the teardown doorman the crop it
  // carries would never be closed.
  it("closes a crop delivered after the session is torn down", () => {
    const { engine, worker } = withContact();
    engine.deactivate();
    const late = new FakeImageBitmap();
    worker.emit({
      type: "detections",
      detections: [policeDetection(0.85, 0.15, 0.25)],
      timing,
      crop: { image: late as unknown as ImageBitmap, detectionIndex: 0 },
    });
    expect(late.close).toHaveBeenCalled();
    expect(contact(engine)).toBeUndefined();
  });

  // Once cutouts are off the worker stops producing crops, so nothing ever
  // swaps the published contact out again; the settings edge is the last
  // owner that can close it.
  it("closes the published contact when cutouts are turned off", () => {
    const { engine, worker } = withContact();
    const image = new FakeImageBitmap();
    worker.emit({
      type: "detections",
      detections: [policeDetection(0.85, 0.15, 0.25)],
      timing,
      crop: { image: image as unknown as ImageBitmap, detectionIndex: 0 },
    });
    engine.updateSettings({
      ...DEFAULT_ENGINE_SETTINGS,
      includeContact: false,
    });
    expect(image.close).toHaveBeenCalled();
    expect(contact(engine)).toBeUndefined();
  });

  it("publishes no contact, and closes the crop, while cutouts are off", () => {
    const { engine, worker } = withContact({ includeContact: false });
    const image = new FakeImageBitmap();
    worker.emit({
      type: "detections",
      detections: [policeDetection(0.85, 0.15, 0.25)],
      timing,
      crop: { image: image as unknown as ImageBitmap, detectionIndex: 0 },
    });
    expect(contact(engine)).toBeUndefined();
    expect(image.close).toHaveBeenCalled();
  });
});

describe("the scene-change gate", () => {
  const police = {
    label: "police",
    score: 0.9,
    box: { xmin: 0.4, ymin: 0.5, xmax: 0.6, ymax: 0.8 },
  };
  const timing = { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 };

  /** The detect requests the pump has posted so far. */
  const detects = (worker: FakeWorker) =>
    worker.posted.filter((message) => message.type === "detect");

  /** An engine whose first capture has reached the worker. */
  const scanning = async ({ sceneGate = true } = {}) => {
    const engineBuilt = testEngine();
    if (!sceneGate) {
      engineBuilt.engine.updateSettings({
        ...DEFAULT_ENGINE_SETTINGS,
        sceneGate,
      });
    }
    engineBuilt.worker.emit({ type: "ready" });
    engineBuilt.engine.setInputs({ video: fakeVideo() });
    await vi.advanceTimersByTimeAsync(0);
    return engineBuilt;
  };

  /** Answer the outstanding frame with a skip and let the next one go out. */
  const skipAndAdvance = async (worker: FakeWorker) => {
    worker.emit({ type: "scan-skipped", gateMs: 0.4, delta: 0.2 });
    await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
  };

  it("keeps pumping after a skip instead of waiting on a frame already answered", async () => {
    // A skip is a reply, so the pump has to treat it as one. If it waited for a
    // detections message that is never coming, the reply watchdog would recycle
    // a worker that did exactly what it was asked.
    const { worker } = await scanning();
    expect(detects(worker)).toHaveLength(1);
    await skipAndAdvance(worker);
    expect(detects(worker)).toHaveLength(2);
  });

  it("holds the detection a skipped frame cannot have lost", async () => {
    // The reason a skip is its own message rather than an empty result. An
    // empty result would advance the coasting tracker toward dropping the
    // vehicle and decay the meter behind it, which would be a lie: a scene that
    // did not change cannot have lost what the last scan found.
    const { engine, worker } = await scanning();
    worker.emit({ type: "detections", detections: [police], timing });
    expect(engine.getSnapshot().hud?.top).toBeDefined();
    await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
    // More skips than the tracker's coasting tolerance, so a tracker being
    // advanced would have dropped the track by now.
    await skipAndAdvance(worker);
    await skipAndAdvance(worker);
    await skipAndAdvance(worker);
    expect(engine.getSnapshot().hud?.top).toBeDefined();
  });

  it("leaves the published scan's tracks untouched on a skip", async () => {
    // If a skip republished the scan, or advanced the tracker behind it, the
    // ids the scene view keys its objects on would churn or coast away while
    // the scene is provably unchanged.
    const { engine, worker } = await scanning();
    worker.emit({ type: "detections", detections: [police], timing });
    const tracks = engine.getSnapshot().scan?.tracks;
    expect(tracks).toMatchObject([
      { id: expect.any(String) as string, box: { xmin: 0.4 } },
    ]);
    // More skips than the tracker's coasting tolerance, so a tracker being
    // advanced would have dropped the track (and its id) by now.
    await skipAndAdvance(worker);
    await skipAndAdvance(worker);
    await skipAndAdvance(worker);
    expect(engine.getSnapshot().scan?.tracks).toBe(tracks);
  });

  it("scans the first frame of a span before it trusts the gate", async () => {
    // The pump starts on a fresh worker, after a recycle, and on every resume
    // from a pause, and in the last of those the road has had an unbounded
    // amount of time to change while nobody was looking.
    const { worker } = await scanning();
    expect(detects(worker)[0]).toMatchObject({ forceScan: true });
  });

  it("lets the gate decide once a scan has landed", async () => {
    const { worker } = await scanning();
    worker.emit({ type: "detections", detections: [], timing });
    await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
    expect(detects(worker)[1]).toMatchObject({ forceScan: false });
  });

  it("demands a scan once skipping has run past the cap", async () => {
    // The backstop. A threshold set above what a distant vehicle produces, and
    // a camera feed that has quietly frozen, both look from in here exactly
    // like a scene that is genuinely still, so the gate is not trusted to be
    // its own check on how long it has been since the model last ran.
    const { worker } = await scanning();
    worker.emit({ type: "detections", detections: [], timing });
    let forced = 0;
    const scans = Math.ceil(SCENE_GATE_MAX_SKIP_MS / MIN_FRAME_INTERVAL_MS) + 1;
    for (let scan = 0; scan < scans; scan += 1) {
      await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
      const latest = detects(worker).at(-1);
      if (latest?.type === "detect" && latest.forceScan) {
        forced += 1;
      }
      worker.emit({ type: "scan-skipped", gateMs: 0.4, delta: 0.2 });
    }
    expect(forced).toBeGreaterThan(0);
  });

  it("scans every frame while the gate is switched off", async () => {
    // The developer escape hatch, which is what the gate's cost and its effect
    // on detections get measured against on a device.
    const { worker } = await scanning({ sceneGate: false });
    worker.emit({ type: "detections", detections: [], timing });
    await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
    // Both of them, so the assertion is not satisfied by the first frame's
    // force alone, which every span gets whether the gate is on or off.
    expect(detects(worker)).toHaveLength(2);
    expect(detects(worker).every((message) => message.forceScan)).toBe(true);
  });
});

describe("model load", () => {
  it("asks whether the device is supported before waiting to load", async () => {
    // The GPU verdict decides whether the app is usable at all, so it must not
    // sit behind the load's wait for service-worker control: the probe goes out
    // synchronously on activation, while `load` is still a pending microtask.
    const { worker } = testEngine();
    expect(worker.posted).toEqual([{ type: "probe" }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(loadMessage(worker)).toMatchObject({
      type: "load",
      model: { id: DEFAULT_MODEL.id },
    });
  });

  it("holds the model download until the owner allows it", async () => {
    const { engine, worker } = testEngine({ deferModelLoad: true });
    // A microtask is all the un-deferred load waits for, so letting one pass is
    // what makes the absence below mean something.
    await vi.advanceTimersByTimeAsync(0);
    // The GPU verdict is not part of the deal: a device that cannot run the
    // detector still has to be turned away, whether or not anything downloads.
    expect(worker.posted).toEqual([{ type: "probe" }]);
    engine.allowModelLoad();
    await vi.advanceTimersByTimeAsync(0);
    expect(loadMessage(worker)).toMatchObject({
      type: "load",
      model: { id: DEFAULT_MODEL.id },
    });
  });

  it("moves to ready when the worker reports ready", () => {
    const { engine, worker } = testEngine();
    expect(engine.getSnapshot().status).toBe("loading-model");
    worker.emit({ type: "ready" });
    expect(engine.getSnapshot().status).toBe("ready");
  });

  // The words a checkpoint gives its classes exist in the file and nowhere
  // else, so the load is the only chance to learn them; the model card reads
  // them from here to say what the running detector looks for.
  it("publishes the classes the loaded checkpoint named", () => {
    const { engine, worker } = testEngine();
    expect(engine.getSnapshot().loadedClasses).toBeUndefined();
    worker.emit({
      type: "ready",
      loaded: { headWidth: 2, classes: [{ index: 1, label: "police" }] },
    });
    expect(engine.getSnapshot().loadedClasses).toEqual([
      { index: 1, label: "police" },
    ]);
  });

  it("reports a checkpoint that names nothing as naming nothing", () => {
    const { engine, worker } = testEngine();
    worker.emit({
      type: "ready",
      loaded: { headWidth: 2, classes: [{ index: 1, label: "police" }] },
    });
    // A recycle rebuilds the session from the same entry, so a rebuild that
    // reports no classes is the truth about what is running now, not a gap to
    // paper over with what the last session said.
    worker.emit({ type: "ready" });
    expect(engine.getSnapshot().loadedClasses).toBeUndefined();
  });

  it("surfaces an unsupported device as a terminal error", () => {
    const { engine, worker } = testEngine();
    worker.emit({ type: "worker-error", code: "WEBGPU_UNSUPPORTED" });
    expect(engine.getSnapshot()).toMatchObject({
      status: "error",
      error: "WEBGPU_UNSUPPORTED",
    });
  });

  it("surfaces worker errors", () => {
    const { engine, worker, telemetry } = testEngine();
    worker.emit({ type: "worker-error", code: "MODEL_LOAD_FAILED" });
    expect(engine.getSnapshot()).toMatchObject({
      status: "error",
      error: "MODEL_LOAD_FAILED",
    });
    expect(telemetry.error).toHaveBeenCalledWith(
      "MODEL_LOAD_FAILED",
      undefined,
    );
  });

  // Pagehide is the one synchronous chance to hand the worker's memory back
  // before the page departs; WebKit reclaims a departed page's worker lazily
  // at best, and the residue stacking up across reloads in one WebContent
  // process is what walks it into the per-process kill.
  it("terminates the worker on pagehide", () => {
    const { worker } = testEngine();
    worker.emit({ type: "ready" });
    window.dispatchEvent(new Event("pagehide"));
    expect(worker.terminate).toHaveBeenCalled();
  });

  it("reactivates on the bfcache restore of a pagehide it acted on", () => {
    const { workers } = testEngine();
    window.dispatchEvent(new Event("pagehide"));
    expect(workers).toHaveLength(1);
    const pageshow = new Event("pageshow");
    Object.defineProperty(pageshow, "persisted", { value: true });
    window.dispatchEvent(pageshow);
    expect(workers).toHaveLength(2);
  });

  it("ignores a pageshow that is not a bfcache restore", () => {
    const { workers } = testEngine();
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pageshow"));
    expect(workers).toHaveLength(1);
  });

  // Guard for the new branch: reactivation is scoped to a pagehide this
  // handler acted on, so a bfcache restore must not resurrect an engine that
  // halted on an error before the page ever departed.
  it("does not resurrect an error-halted engine on a bfcache restore", () => {
    const { engine, workers, worker } = testEngine();
    worker.emit({ type: "worker-error", code: "GPU_DEVICE_LOST" });
    const pageshow = new Event("pageshow");
    Object.defineProperty(pageshow, "persisted", { value: true });
    window.dispatchEvent(pageshow);
    expect(workers).toHaveLength(1);
    expect(engine.getSnapshot().status).toBe("error");
  });

  // A halt ends the activation over the same falling edge deactivate() uses;
  // a halt that left active$ true would make activate() early-return, so the
  // engine could never come back from a crash without a deactivate() first.
  it("can be reactivated after a worker error", () => {
    const { engine, workers, worker } = testEngine();
    worker.emit({ type: "worker-error", code: "INFERENCE_FAILED" });
    expect(engine.getSnapshot().status).toBe("error");
    expect(worker.terminate).toHaveBeenCalled();
    engine.activate();
    expect(workers).toHaveLength(2);
    expect(engine.getSnapshot().status).not.toBe("error");
  });

  it("treats a worker that dies without a message as a crash", () => {
    const { worker, telemetry } = testEngine();
    worker.onerror?.(new ErrorEvent("error"));
    expect(telemetry.error).toHaveBeenCalledWith("WORKER_CRASHED");
  });

  it("flags a network download, but not a load served from cache", () => {
    const fresh = testEngine();
    expect(fresh.engine.getSnapshot().downloadingModel).toBe(false);
    fresh.worker.emit({ type: "model-load-start", fromCache: false });
    expect(fresh.engine.getSnapshot().downloadingModel).toBe(true);

    const cached = testEngine();
    cached.worker.emit({ type: "model-load-start", fromCache: true });
    expect(cached.engine.getSnapshot().downloadingModel).toBe(false);
  });

  it("accumulates per-file model progress", () => {
    const { engine, worker } = testEngine();
    worker.emit({
      type: "model-progress",
      progress: { file: "model.onnx", loaded: 50, total: 100 },
    });
    worker.emit({
      type: "model-progress",
      progress: { file: "model.onnx", loaded: 80, total: 100 },
    });
    worker.emit({
      type: "model-progress",
      progress: { file: "config.json", loaded: 10, total: 10 },
    });
    expect(engine.getSnapshot().modelProgress.loadedBytes).toBe(90);
  });

  it("tells the telemetry sink how the weights arrived", () => {
    const { worker, telemetry } = testEngine();
    worker.emit({ type: "model-load-start", fromCache: false });
    worker.emit({ type: "model-downloaded", durationMs: 8_400 });
    worker.emit({ type: "ready" });
    expect(telemetry.modelLoadStart).toHaveBeenCalledWith(false);
    expect(telemetry.modelDownloaded).toHaveBeenCalledWith(8_400);
    expect(telemetry.modelReady).toHaveBeenCalled();
  });
});

describe("the frame pump", () => {
  const timing = { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 };
  const car = {
    label: "car",
    score: 0.9,
    box: { xmin: 0.4, ymin: 0.5, xmax: 0.6, ymax: 0.8 },
  };
  const emptyResult = { type: "detections" as const, detections: [], timing };

  /** An engine whose first capture has reached the worker. */
  const scanning = async (video?: HTMLVideoElement) => {
    const engineBuilt = testEngine();
    engineBuilt.worker.emit({ type: "ready" });
    engineBuilt.engine.setInputs({ video: video ?? fakeVideo() });
    await vi.advanceTimersByTimeAsync(0);
    return engineBuilt;
  };

  it("pumps a frame after start and another after each result", async () => {
    const { engine, worker } = await scanning();
    expect(detectCount(worker)).toBe(1);
    worker.emit({ type: "detections", detections: [car], timing });
    expect(engine.getSnapshot().status).toBe("running");
    // The tracker registers a detection on its first frame, so its blip
    // reaches the HUD immediately.
    expect(engine.getSnapshot().hud?.top).toBeDefined();
    // The next frame goes out once the pacing interval elapses.
    await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
    expect(detectCount(worker)).toBe(2);
  });

  it("hears a result that arrives synchronously with the post", async () => {
    // A worker that answers before postMessage returns: legal for a worker
    // shim, and the worst-case scheduling for the pump's reply listener. The
    // pump must have that listener in place at post time, not attach it a
    // tick later, or this reply lands on nothing and the pump stalls.
    const { engine, worker } = testEngine();
    const post = worker.postMessage.bind(worker);
    worker.postMessage = (message: WorkerRequest) => {
      post(message);
      if (message.type === "detect") {
        worker.emit(emptyResult);
      }
    };
    worker.emit({ type: "ready" });
    engine.setInputs({ video: fakeVideo() });
    await vi.advanceTimersByTimeAsync(0);
    expect(detectCount(worker)).toBe(1);
    // The synchronous reply was heard, so pacing is already scheduled and
    // the next frame goes out on time instead of never.
    await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
    expect(detectCount(worker)).toBe(2);
  });

  it("publishes each scan's own detections with the frame they came from", async () => {
    const { engine, worker } = await scanning();
    expect(engine.getSnapshot().scan).toBeUndefined();
    worker.emit({
      type: "detections",
      detections: [
        car,
        {
          label: "police",
          score: 0.2,
          box: { xmin: 0.1, ymin: 0.1, xmax: 0.2, ymax: 0.2 },
        },
      ],
      timing,
    });
    // The confidence filter runs before publication, so the low-score
    // detection never reaches the overlay, and the frame geometry is the
    // captured bitmap's own.
    expect(engine.getSnapshot().scan).toMatchObject({
      detections: [{ label: "car" }],
      frame: { width: 1280 },
      zoom: ZOOM_OFF,
    });
  });

  it("drops a scan's boxes as soon as the model stops seeing them", async () => {
    const { engine, worker } = await scanning();
    worker.emit({ type: "detections", detections: [car], timing });
    await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
    worker.emit(emptyResult);
    // The tracker coasts the lost car, so the HUD still shows it; the scan is
    // raw per-frame output, so its box is gone the moment the model loses it.
    expect(engine.getSnapshot().hud?.top).toBeDefined();
    expect(engine.getSnapshot().scan?.detections).toHaveLength(0);
  });

  it("publishes tracks whose id stays with the same box across results", async () => {
    const { engine, worker } = await scanning();
    worker.emit({ type: "detections", detections: [car], timing });
    const [firstTrack] = engine.getSnapshot().scan?.tracks ?? [];
    expect(firstTrack).toMatchObject({ box: { xmin: 0.4 } });
    await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
    // The next result sees the same object drifted slightly (an IoU match)
    // plus a brand-new one across the frame: the drifted box keeps its id, the
    // newcomer gets its own.
    worker.emit({
      type: "detections",
      detections: [
        { ...car, box: { xmin: 0.42, ymin: 0.52, xmax: 0.62, ymax: 0.82 } },
        { ...car, box: { xmin: 0.05, ymin: 0.05, xmax: 0.15, ymax: 0.15 } },
      ],
      timing,
    });
    const tracks = engine.getSnapshot().scan?.tracks ?? [];
    expect(tracks).toMatchObject([
      { box: { xmin: 0.42 } },
      { box: { xmin: 0.05 } },
    ]);
    expect(tracks[0].id).toBe(firstTrack.id);
    expect(tracks[1].id).not.toBe(firstTrack.id);
  });

  it("emits each scan's filtered detections on rawDetections$ and nothing on a skip", async () => {
    const { engine, worker } = await scanning();
    const emissions: RawDetections[] = [];
    const subscription = engine.rawDetections$.subscribe((scanned) => {
      emissions.push(scanned);
    });
    worker.emit({
      type: "detections",
      detections: [
        car,
        {
          label: "police",
          score: 0.2,
          box: { xmin: 0.1, ymin: 0.1, xmax: 0.2, ymax: 0.2 },
        },
      ],
      timing,
    });
    // One emission per completed scan, already confidence-filtered, and
    // without identity: that is the derived stream's job.
    expect(emissions).toHaveLength(1);
    expect(emissions[0].detections).toMatchObject([{ label: "car" }]);
    expect("id" in emissions[0].detections[0]).toBe(false);
    // A skip publishes nothing here either: a frame that did not change
    // cannot have changed what the last one found.
    await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
    worker.emit({ type: "scan-skipped", gateMs: 1, delta: 0 });
    expect(emissions).toHaveLength(1);
    subscription.unsubscribe();
  });

  it("derives identifiedDetections$ from the raw scans, sharing ids with the snapshot", async () => {
    const { engine, worker } = await scanning();
    const identified: IdentifiedDetections[] = [];
    const subscription = engine.identifiedDetections$.subscribe((scanned) => {
      identified.push(scanned);
    });
    worker.emit({ type: "detections", detections: [car], timing });
    await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
    worker.emit({
      type: "detections",
      detections: [
        { ...car, box: { xmin: 0.42, ymin: 0.52, xmax: 0.62, ymax: 0.82 } },
      ],
      timing,
    });
    expect(identified).toHaveLength(2);
    // The drifted re-detection carries the id minted at first sighting.
    expect(identified[1].detections[0].id).toBe(identified[0].detections[0].id);
    // One tracker step per scan however many subscribers: the emission this
    // external subscription saw is the very object the snapshot published,
    // so stream consumers and the HUD can never disagree about identity.
    expect(engine.getSnapshot().scan?.tracks).toBe(identified[1].tracks);
    subscription.unsubscribe();
  });

  it("retries frame capture after createImageBitmap fails once", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("video has no frame data"))
        .mockImplementation(() => Promise.resolve(fakeBitmap())),
    );
    const { engine, worker } = testEngine();
    worker.emit({ type: "ready" });
    engine.setInputs({ video: fakeVideo() });
    // First capture rejects (no detect posted), scheduling a retry.
    await vi.advanceTimersByTimeAsync(0);
    expect(detectCount(worker)).toBe(0);
    // The retry fires after FRAME_RETRY_MS and succeeds.
    await vi.advanceTimersByTimeAsync(FRAME_RETRY_MS);
    expect(detectCount(worker)).toBe(1);
  });

  it("counts consecutive capture failures and clears the streak on success", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("video has no frame data"))
        .mockRejectedValueOnce(new Error("video has no frame data"))
        .mockImplementation(() => Promise.resolve(fakeBitmap())),
    );
    const { engine, worker } = testEngine();
    worker.emit({ type: "ready" });
    engine.setInputs({ video: fakeVideo() });
    // Two captures fail back to back; the streak is visible mid-retry.
    await vi.advanceTimersByTimeAsync(FRAME_RETRY_MS);
    expect(engine.getDebugSnapshot().captureFailures).toBe(2);
    // The third capture succeeds and posts, ending the streak.
    await vi.advanceTimersByTimeAsync(FRAME_RETRY_MS);
    expect(detectCount(worker)).toBe(1);
    expect(engine.getDebugSnapshot().captureFailures).toBe(0);
  });

  it("paces the next frame to the minimum interval after a fast result", async () => {
    const { worker } = await scanning();
    expect(detectCount(worker)).toBe(1);
    // A result arriving well before the pacing floor must not re-prime the
    // pump immediately.
    worker.emit(emptyResult);
    await vi.advanceTimersByTimeAsync(0);
    expect(detectCount(worker)).toBe(1);
    // Once the interval elapses, exactly one more frame goes out.
    await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
    expect(detectCount(worker)).toBe(2);
  });

  it("rests a fraction of the round trip after a slow result", async () => {
    const { worker } = await scanning();
    expect(detectCount(worker)).toBe(1);
    // A slow device: the result lands well past the pacing floor, so the
    // proportional rest governs instead. The expected wait comes from the
    // pacing rule itself rather than being restated here, so this covers the
    // pump honoring the decision and needs no edit when the rule is retuned.
    const roundTripMs = 1_000;
    const restMs = pacingDelay(roundTripMs).delayMs;
    await vi.advanceTimersByTimeAsync(roundTripMs);
    worker.emit({
      type: "detections",
      detections: [],
      timing: { preprocessMs: 5, inferenceMs: 990, decodeMs: 5 },
    });
    // The pump rests out the decision, so just short of it nothing is posted.
    await vi.advanceTimersByTimeAsync(restMs - 100);
    expect(detectCount(worker)).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(detectCount(worker)).toBe(2);
  });

  it("does not pump a paced frame scheduled before the pump stopped", async () => {
    const { engine, worker } = await scanning();
    // The result schedules a paced frame, then the video detaches before it
    // fires.
    worker.emit(emptyResult);
    engine.setInputs({ video: undefined });
    await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS * 2);
    expect(detectCount(worker)).toBe(1);
  });

  it("captures only when the camera presents a new frame", async () => {
    const { video, presentFrame } = videoWithControlledFrames();
    const { engine, worker } = testEngine();
    worker.emit({ type: "ready" });
    engine.setInputs({ video });
    // No camera frame has been presented yet: the pump must hold the capture.
    await vi.advanceTimersByTimeAsync(0);
    expect(detectCount(worker)).toBe(0);
    presentFrame();
    await vi.advanceTimersByTimeAsync(0);
    expect(detectCount(worker)).toBe(1);
  });

  it("discards a capture whose camera frame arrives after the pump stopped", async () => {
    const { video, presentFrame } = videoWithControlledFrames();
    const { engine, worker } = testEngine();
    worker.emit({ type: "ready" });
    engine.setInputs({ video });
    // The stop lands while the pump is still waiting for a camera frame; the
    // frame arriving afterwards must not trigger a capture.
    engine.setInputs({ video: undefined });
    presentFrame();
    await vi.advanceTimersByTimeAsync(0);
    expect(detectCount(worker)).toBe(0);
  });

  it("keeps one frame in flight across a fast stop-then-start", async () => {
    let closedFrames = 0;
    const pendingCaptures: Array<(bitmap: ImageBitmap) => void> = [];
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(
        () =>
          new Promise<ImageBitmap>((resolve) => {
            pendingCaptures.push(resolve);
          }),
      ),
    );
    const countingBitmap = () =>
      ({
        width: 1280,
        height: 720,
        close: () => {
          closedFrames += 1;
        },
      }) as unknown as ImageBitmap;
    const { engine, worker } = testEngine();
    worker.emit({ type: "ready" });
    engine.setInputs({ video: fakeVideo() });
    // Flush the frame-wait microtask so capture #1 is pending, then stop and
    // quickly start again (capture #2).
    await vi.advanceTimersByTimeAsync(0);
    engine.setInputs({ video: undefined });
    engine.setInputs({ video: fakeVideo() });
    await vi.advanceTimersByTimeAsync(0);
    for (const resolveCapture of pendingCaptures.splice(0)) {
      resolveCapture(countingBitmap());
    }
    await vi.advanceTimersByTimeAsync(0);
    // Only the restarted pump's frame is posted; the stale one is closed.
    expect(detectCount(worker)).toBe(1);
    expect(closedFrames).toBe(1);
  });

  it("re-primes at depth one when a stale result lands after a stop and start", async () => {
    const { engine, worker } = await scanning();
    expect(detectCount(worker)).toBe(1);
    // Stop, then restart before the stale result comes back.
    engine.setInputs({ video: undefined });
    engine.setInputs({ video: fakeVideo() });
    // The restarted pump must not post while frame #1's result is pending.
    await vi.advanceTimersByTimeAsync(0);
    expect(detectCount(worker)).toBe(1);
    // The stale result re-primes the pump: exactly one more post once the
    // pacing interval elapses.
    worker.emit(emptyResult);
    await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
    expect(detectCount(worker)).toBe(2);
    // Pipeline continues at depth one: the next result posts exactly one more.
    worker.emit(emptyResult);
    await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
    expect(detectCount(worker)).toBe(3);
  });

  it("exposes a debug snapshot from detection results", async () => {
    const { engine, worker } = await scanning();
    worker.emit({
      type: "detections",
      detections: [car],
      timing: { preprocessMs: 1, inferenceMs: 2, decodeMs: 3 },
    });
    const debug = engine.getDebugSnapshot();
    expect(debug).toMatchObject({
      rawCount: 1,
      filteredCount: 1,
      inferenceMs: 2,
      // The result came back near-instantly, so the floor set the delay.
      pacingRule: "floor",
    });
    expect(debug.overheadMs).toBeGreaterThanOrEqual(0);
    expect(debug.pacingDelayMs).toBeGreaterThan(0);
    expect(debug.pacingDelayMs).toBeLessThanOrEqual(MIN_FRAME_INTERVAL_MS);
  });
});

describe("what the pump captures", () => {
  const police = {
    label: "police",
    score: 0.9,
    box: { xmin: 0.4, ymin: 0.5, xmax: 0.6, ymax: 0.8 },
  };
  const timing = { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 };

  /** An engine scanning with one setting moved off its default. */
  const scanning = async (settings: Partial<EngineSettings> = {}) => {
    const capture = vi.fn(() => Promise.resolve(fakeBitmap()));
    vi.stubGlobal("createImageBitmap", capture);
    const engineBuilt = testEngine();
    engineBuilt.engine.updateSettings({
      ...DEFAULT_ENGINE_SETTINGS,
      ...settings,
    });
    engineBuilt.worker.emit({ type: "ready" });
    engineBuilt.engine.setInputs({ video: fakeVideo() });
    await vi.advanceTimersByTimeAsync(0);
    return { ...engineBuilt, capture };
  };

  const detect = (worker: FakeWorker) =>
    worker.posted.find((message) => message.type === "detect");

  it("starts the pump when ready arrives after the video is attached", async () => {
    const { engine, worker } = testEngine();
    engine.setInputs({ video: fakeVideo() });
    await vi.advanceTimersByTimeAsync(0);
    expect(detectCount(worker)).toBe(0);
    worker.emit({ type: "ready" });
    await vi.advanceTimersByTimeAsync(0);
    expect(detectCount(worker)).toBe(1);
  });

  it("surfaces a detection immediately on its first frame", () => {
    const { engine, worker } = testEngine();
    worker.emit({ type: "ready" });
    worker.emit({ type: "detections", detections: [police], timing });
    expect(engine.getSnapshot().hud?.top).toBeDefined();
  });

  it("coasts a detection's box through a frame the model misses it", () => {
    const { engine, worker } = testEngine();
    worker.emit({ type: "ready" });
    worker.emit({ type: "detections", detections: [police], timing });
    expect(engine.getSnapshot().hud?.top).toBeDefined();
    // Next frame has no detections: the track coasts, so the box stays shown.
    worker.emit({ type: "detections", detections: [], timing });
    expect(engine.getSnapshot().hud?.top).toBeDefined();
  });

  it("captures only the model's input while cutouts are off", async () => {
    const { worker, capture } = await scanning({ includeContact: false });
    // The centered square of a 1280x720 frame, resized to the model's input.
    expect(capture).toHaveBeenCalledWith(
      expect.anything(),
      280,
      0,
      720,
      720,
      expect.objectContaining({
        resizeWidth: INPUT_SIZE,
        resizeHeight: INPUT_SIZE,
      }),
    );
    // The worker is told which frame the crop came from, so the boxes it maps
    // back out still describe the whole frame rather than the crop.
    expect(detect(worker)).toMatchObject({
      source: { width: 1280, height: 720 },
    });
  });

  it("captures the whole frame while cutouts are on", async () => {
    const { worker, capture } = await scanning({ includeContact: true });
    // The cutout is cut from the frame's own pixels, so nothing may be cropped
    // or thrown away before the worker sees it, and the worker must be left to
    // do the cropping itself.
    expect(capture).toHaveBeenCalledWith(expect.anything());
    expect(detect(worker)?.source).toBeUndefined();
  });

  it("captures the region the zoom it declares selects", async () => {
    const { worker, capture } = await scanning({ zoom: ZOOM_2X });
    expect(detect(worker)).toMatchObject({ zoom: ZOOM_2X });
    // Half the short edge, centered: the crop the declared zoom describes. A
    // capture cropped at one zoom and labelled with another would have the
    // worker map every box back through the wrong region.
    expect(capture).toHaveBeenCalledWith(
      expect.anything(),
      460,
      180,
      360,
      360,
      expect.anything(),
    );
  });

  it("asks the worker for a cutout only while they are on", async () => {
    const off = await scanning({ includeContact: false });
    expect(detect(off.worker)).toMatchObject({ includeCrop: false });
    const on = await scanning({ includeContact: true });
    expect(detect(on.worker)).toMatchObject({ includeCrop: true });
  });
});
