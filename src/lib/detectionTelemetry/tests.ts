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
});
