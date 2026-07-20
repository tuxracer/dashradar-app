import { describe, expect, it } from "vitest";
import type { Detection, NormalizedBox } from "@/types";
import {
  createDetectionTracker,
  initialTrackerState,
  iou,
  stepTracker,
  type TrackerConfig,
} from "@/lib/detectionTracker";

const box = (
  xmin: number,
  ymin: number,
  xmax: number,
  ymax: number,
): NormalizedBox => ({ xmin, ymin, xmax, ymax });

const detection = (overrides: Partial<Detection> = {}): Detection => ({
  label: "police",
  displayLabel: "POLICE",
  category: "vehicle",
  score: 0.9,
  box: box(0.4, 0.5, 0.6, 0.8),
  ...overrides,
});

const config: TrackerConfig = {
  persistMs: 500,
  iouMatchThreshold: 0.3,
  maxMisses: 2,
};

describe("iou", () => {
  it("is 1 for identical boxes", () => {
    expect(iou(box(0, 0, 1, 1), box(0, 0, 1, 1))).toBe(1);
  });

  it("is 0 for disjoint boxes", () => {
    expect(iou(box(0, 0, 0.1, 0.1), box(0.5, 0.5, 0.6, 0.6))).toBe(0);
  });

  it("is between 0 and 1 for partial overlap", () => {
    const value = iou(box(0, 0, 0.5, 0.5), box(0.25, 0.25, 0.75, 0.75));
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(1);
  });
});

describe("stepTracker", () => {
  it("does not show a detection on its first sighting", () => {
    const { visible } = stepTracker(
      initialTrackerState(),
      [detection()],
      0,
      config,
    );
    expect(visible).toHaveLength(0);
  });

  it("confirms and shows a detection once it persists past persistMs", () => {
    const first = stepTracker(initialTrackerState(), [detection()], 0, config);
    expect(first.visible).toHaveLength(0);
    const second = stepTracker(first.state, [detection()], 500, config);
    expect(second.visible).toHaveLength(1);
    expect(second.visible[0].label).toBe("police");
  });

  it("drops a single-frame blip instead of confirming it", () => {
    const first = stepTracker(initialTrackerState(), [detection()], 0, config);
    // Next frame has no detection at all: the pending track is dropped.
    const second = stepTracker(first.state, [], 500, config);
    expect(second.visible).toHaveLength(0);
    expect(second.state.tracks).toHaveLength(0);
    // The same box reappearing later starts a brand-new pending track.
    const third = stepTracker(second.state, [detection()], 600, config);
    expect(third.visible).toHaveLength(0);
  });

  it("coasts a confirmed track through maxMisses frames, then drops it", () => {
    let state = initialTrackerState();
    state = stepTracker(state, [detection()], 0, config).state;
    const confirmed = stepTracker(state, [detection()], 500, config);
    expect(confirmed.visible).toHaveLength(1);
    state = confirmed.state;
    // Miss 1: still visible (coasting).
    const miss1 = stepTracker(state, [], 600, config);
    expect(miss1.visible).toHaveLength(1);
    // Miss 2: still visible (coasting).
    const miss2 = stepTracker(miss1.state, [], 700, config);
    expect(miss2.visible).toHaveLength(1);
    // Miss 3: exceeds maxMisses, dropped.
    const miss3 = stepTracker(miss2.state, [], 800, config);
    expect(miss3.visible).toHaveLength(0);
    expect(miss3.state.tracks).toHaveLength(0);
  });

  it("keeps one track as its box drifts across frames (IoU match)", () => {
    let state = initialTrackerState();
    state = stepTracker(
      state,
      [detection({ box: box(0.4, 0.5, 0.6, 0.8) })],
      0,
      config,
    ).state;
    const drifted = stepTracker(
      state,
      [detection({ box: box(0.42, 0.52, 0.62, 0.82) })],
      500,
      config,
    );
    expect(drifted.state.tracks).toHaveLength(1);
    expect(drifted.visible).toHaveLength(1);
  });

  it("adopts the newest matched detection's box and score", () => {
    let state = initialTrackerState();
    state = stepTracker(state, [detection({ score: 0.8 })], 0, config).state;
    const updated = stepTracker(
      state,
      [detection({ score: 0.95, box: box(0.41, 0.51, 0.61, 0.81) })],
      500,
      config,
    );
    expect(updated.visible[0].score).toBe(0.95);
    expect(updated.visible[0].box.xmin).toBeCloseTo(0.41);
  });
});

describe("createDetectionTracker", () => {
  it("holds state across update calls", () => {
    const tracker = createDetectionTracker(config);
    expect(tracker.update([detection()], 0)).toHaveLength(0);
    expect(tracker.update([detection()], 500)).toHaveLength(1);
  });
});
