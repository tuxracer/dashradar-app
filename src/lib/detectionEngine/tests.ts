import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_RELEASE } from "@/lib/appRelease";
import {
  HEARTBEAT_INTERVAL_MS,
  SENTINEL_STORAGE_KEY,
} from "@/lib/crashSentinel";
import { DEFAULT_MODEL } from "@/lib/detectionModels";
import type { DetectionTelemetry } from "@/lib/detectionTelemetry";
import type { WorkerRequest, WorkerResponse } from "@/workers/detection/types";
import { createDetectionEngine, pacingDelay } from "./index";
import { MAX_FRAME_INTERVAL_MS, MIN_FRAME_INTERVAL_MS } from "./consts";
import type { DetectionEngine, DetectionWorkerLike } from "./types";

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
 * An activated engine on a fake worker. `worker` is the one it spawned, so a
 * test emits worker messages through it and reads what the pump posted.
 */
const testEngine = ({ deferModelLoad = false } = {}) => {
  const worker = new FakeWorker();
  const telemetry = fakeTelemetry();
  const engine = createDetectionEngine({
    model: DEFAULT_MODEL,
    createWorker: () => worker,
    telemetry,
    deferModelLoad,
  });
  built.push(engine);
  engine.activate();
  return { engine, worker, telemetry };
};

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

  it("rewrites the sentinel on the next beat after a bfcache-style pagehide", async () => {
    scanning();
    window.dispatchEvent(new Event("pagehide"));
    expect(readSentinel()).toBeNull();
    // The page came back from the bfcache instead of unloading: the interval
    // is still alive, so the next tick restores crash coverage.
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
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
