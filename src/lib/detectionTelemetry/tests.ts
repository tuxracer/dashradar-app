import { track } from "@vercel/analytics";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL } from "@/lib/detectionModels";
import {
  LATE_TIMING_AFTER_MS,
  readTimingHistory,
  TIMING_HISTORY_LIMIT,
} from "@/lib/timingHistory";
import { createDetectionTelemetry } from "./index";

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(track).mockClear();
  window.sessionStorage.clear();
});

const eventsNamed = (name: string) =>
  vi.mocked(track).mock.calls.filter(([event]) => event === name);

describe("createDetectionTelemetry", () => {
  // The engine recycles its worker every quarter hour and again whenever one
  // wedges, and each fresh worker reports ready and can report a download of
  // its own. Ungated, one drive would look like a fleet of short sessions.
  it("reports a session's one-time events once however often the engine repeats them", () => {
    const telemetry = createDetectionTelemetry(DEFAULT_MODEL);
    telemetry.modelLoadStart(false);
    telemetry.modelReady();
    telemetry.modelDownloaded(4_000);
    telemetry.workerHung();

    telemetry.modelLoadStart(true);
    telemetry.modelReady();
    telemetry.modelDownloaded(4_000);
    telemetry.workerHung();

    expect(eventsNamed("model_ready")).toHaveLength(1);
    expect(eventsNamed("model_downloaded")).toHaveLength(1);
    expect(eventsNamed("worker_hung")).toHaveLength(1);
  });

  it("reports the cache state the session actually started from", () => {
    const telemetry = createDetectionTelemetry(DEFAULT_MODEL);
    telemetry.modelLoadStart(true);
    telemetry.modelReady();
    expect(eventsNamed("model_ready")).toEqual([
      ["model_ready", { fromCache: true }],
    ]);
  });

  // Which weights actually reached the device is the only signal that makes a
  // bad rollout visible before it starts erroring.
  it("names the model and revision the weights came from", () => {
    const telemetry = createDetectionTelemetry(DEFAULT_MODEL);
    telemetry.modelDownloaded(8_400);
    expect(eventsNamed("model_downloaded")).toEqual([
      [
        "model_downloaded",
        {
          model: DEFAULT_MODEL.slug,
          revision: DEFAULT_MODEL.revision,
          seconds: 8,
        },
      ],
    ]);
  });

  // The events mark a session reaching inference at all, not each frame.
  it("reports the first result's timings and then goes quiet", () => {
    const telemetry = createDetectionTelemetry(DEFAULT_MODEL);
    // The frame was in flight for four seconds, of which the worker spent 2400
    // ms in inference, so the two events carry different numbers. Both are
    // bucketed to the nearest half second.
    const timing = { inferenceMs: 2_400, roundTripMs: 4_000 };
    telemetry.result(timing);
    expect(eventsNamed("first_inference")).toEqual([
      ["first_inference", { seconds: 2.5 }],
    ]);
    expect(eventsNamed("first_round_trip")).toEqual([
      ["first_round_trip", { seconds: 4 }],
    ]);
    telemetry.result(timing);
    telemetry.result(timing);
    expect(eventsNamed("first_inference")).toHaveLength(1);
    expect(eventsNamed("first_round_trip")).toHaveLength(1);
  });

  it("rolls each result's timings into the sessionStorage history", () => {
    const telemetry = createDetectionTelemetry(DEFAULT_MODEL);
    expect(readTimingHistory()).toEqual({ roundTrip: [], inference: [] });
    // Two and a half seconds of inference buckets to 2.5.
    telemetry.result({ inferenceMs: 2_500, roundTripMs: 3_000 });
    expect(readTimingHistory()).toEqual({ roundTrip: [3], inference: [2.5] });
  });

  it("reports median timings once the rolling window first fills", () => {
    const telemetry = createDetectionTelemetry(DEFAULT_MODEL);
    const timingEvents = () =>
      vi
        .mocked(track)
        .mock.calls.filter(([event]) => event.startsWith("timing_"));

    // A partial window reports nothing: a median of a couple of readings is
    // not worth an event.
    for (let scan = 0; scan < TIMING_HISTORY_LIMIT - 1; scan += 1) {
      telemetry.result({ inferenceMs: 1_000, roundTripMs: 1_200 });
    }
    expect(timingEvents()).toHaveLength(0);

    // The next result fills the window and reports both medians.
    telemetry.result({ inferenceMs: 1_000, roundTripMs: 1_200 });
    expect(timingEvents()).toEqual([
      ["timing_round_trip", { seconds: 1 }],
      ["timing_inference", { seconds: 1 }],
    ]);

    // The drive keeps scanning and the window keeps rolling; neither event may
    // fire a second time.
    for (let scan = 0; scan < TIMING_HISTORY_LIMIT; scan += 1) {
      telemetry.result({ inferenceMs: 1_000, roundTripMs: 1_200 });
    }
    expect(timingEvents()).toHaveLength(2);
  });

  // The early report is by construction the coldest reading of a drive, so the
  // gap between it and this one is the view of thermal drift on a real mount.
  it("reports the medians again once the drive has scanned long enough", () => {
    const telemetry = createDetectionTelemetry(DEFAULT_MODEL);
    const lateEvents = () =>
      vi.mocked(track).mock.calls.filter(([event]) => event.endsWith("_late"));
    telemetry.scanningStarted();

    // The early report fires here; the late one is not due on scan count.
    for (let scan = 0; scan < TIMING_HISTORY_LIMIT; scan += 1) {
      telemetry.result({ inferenceMs: 1_000, roundTripMs: 1_200 });
    }
    expect(lateEvents()).toHaveLength(0);

    // A quarter hour of scanning later, the same rolling window reports again.
    vi.advanceTimersByTime(LATE_TIMING_AFTER_MS);
    telemetry.result({ inferenceMs: 1_000, roundTripMs: 1_200 });
    expect(lateEvents()).toEqual([
      ["timing_round_trip_late", { seconds: 1 }],
      ["timing_inference_late", { seconds: 1 }],
    ]);

    // Still once per session, however much longer the drive runs.
    for (let scan = 0; scan < TIMING_HISTORY_LIMIT; scan += 1) {
      telemetry.result({ inferenceMs: 1_000, roundTripMs: 1_200 });
    }
    expect(lateEvents()).toHaveLength(2);
  });

  it("carries a platform cause on an error that has one, truncated", () => {
    const telemetry = createDetectionTelemetry(DEFAULT_MODEL);
    telemetry.error("MODEL_LOAD_FAILED");
    telemetry.error("INFERENCE_FAILED", "x".repeat(500));
    const [plain, detailed] = eventsNamed("error");
    expect(plain).toEqual(["error", { code: "MODEL_LOAD_FAILED" }]);
    const detail = (detailed[1] as { detail: string }).detail;
    expect(detail.length).toBeLessThan(500);
  });
});
