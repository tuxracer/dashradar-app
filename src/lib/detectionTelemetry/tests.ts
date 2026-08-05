import { track } from "@vercel/analytics";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL } from "@/lib/detectionModels";
import { createDetectionTelemetry } from "./index";

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

afterEach(() => {
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
    const timing = { inferenceMs: 400, roundTripMs: 600 };
    telemetry.result(timing);
    expect(eventsNamed("first_inference")).toHaveLength(1);
    expect(eventsNamed("first_round_trip")).toHaveLength(1);
    telemetry.result(timing);
    telemetry.result(timing);
    expect(eventsNamed("first_inference")).toHaveLength(1);
    expect(eventsNamed("first_round_trip")).toHaveLength(1);
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
