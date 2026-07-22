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
  iouMatchThreshold: 0.3,
  maxMisses: 2,
  scoreSmoothingAlpha: 0.5,
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
  it("shows a detection immediately on its first sighting", () => {
    const { visible } = stepTracker(
      initialTrackerState(),
      [detection()],
      config,
    );
    expect(visible).toHaveLength(1);
    expect(visible[0].label).toBe("police");
  });

  it("coasts a track through maxMisses frames, then drops it", () => {
    let state = initialTrackerState();
    const shown = stepTracker(state, [detection()], config);
    expect(shown.visible).toHaveLength(1);
    state = shown.state;
    // Miss 1: still visible (coasting).
    const miss1 = stepTracker(state, [], config);
    expect(miss1.visible).toHaveLength(1);
    // Miss 2: still visible (coasting).
    const miss2 = stepTracker(miss1.state, [], config);
    expect(miss2.visible).toHaveLength(1);
    // Miss 3: exceeds maxMisses, dropped.
    const miss3 = stepTracker(miss2.state, [], config);
    expect(miss3.visible).toHaveLength(0);
    expect(miss3.state.tracks).toHaveLength(0);
  });

  it("keeps one track as its box drifts across frames (IoU match)", () => {
    let state = initialTrackerState();
    state = stepTracker(
      state,
      [detection({ box: box(0.4, 0.5, 0.6, 0.8) })],
      config,
    ).state;
    const drifted = stepTracker(
      state,
      [detection({ box: box(0.42, 0.52, 0.62, 0.82) })],
      config,
    );
    expect(drifted.state.tracks).toHaveLength(1);
    expect(drifted.visible).toHaveLength(1);
  });

  it("adopts a matched detection's box outright but eases its score by scoreSmoothingAlpha", () => {
    let state = initialTrackerState();
    state = stepTracker(state, [detection({ score: 0.8 })], config).state;
    const updated = stepTracker(
      state,
      [detection({ score: 0.95, box: box(0.41, 0.51, 0.61, 0.81) })],
      config,
    );
    // Alpha 0.5 moves the score halfway from 0.8 toward 0.95.
    expect(updated.visible[0].score).toBeCloseTo(0.875);
    expect(updated.visible[0].box.xmin).toBeCloseTo(0.41);
  });

  it("damps alternating score jitter instead of passing it through", () => {
    // A static scene where the model alternates 0.94 / 0.76 on the same
    // object. Without smoothing the shown score would swing the full 0.18
    // every frame; with alpha 0.5 the swing settles well inside that band.
    let state = initialTrackerState();
    state = stepTracker(state, [detection({ score: 0.94 })], config).state;
    const shown: number[] = [];
    for (const raw of [0.76, 0.94, 0.76, 0.94]) {
      const stepped = stepTracker(state, [detection({ score: raw })], config);
      state = stepped.state;
      shown.push(stepped.visible[0].score);
    }
    const swings = shown.slice(1).map((score, i) => Math.abs(score - shown[i]));
    expect(Math.max(...swings)).toBeLessThan(0.18 / 2 + 0.001);
  });

  it("adopts the raw score outright when scoreSmoothingAlpha is 1", () => {
    const unsmoothed: TrackerConfig = { ...config, scoreSmoothingAlpha: 1 };
    let state = initialTrackerState();
    state = stepTracker(state, [detection({ score: 0.8 })], unsmoothed).state;
    const updated = stepTracker(
      state,
      [detection({ score: 0.95 })],
      unsmoothed,
    );
    expect(updated.visible[0].score).toBe(0.95);
  });

  it("shows a brand-new track's first score unsmoothed", () => {
    const { visible } = stepTracker(
      initialTrackerState(),
      [detection({ score: 0.91 })],
      config,
    );
    expect(visible[0].score).toBe(0.91);
  });

  it("matches two detections to two separate tracks greedily without double-claiming", () => {
    let state = initialTrackerState();

    // Establish two tracks at distinct boxes.
    state = stepTracker(
      state,
      [
        detection({ box: box(0.1, 0.1, 0.3, 0.3) }),
        detection({ box: box(0.6, 0.6, 0.8, 0.8) }),
      ],
      config,
    ).state;

    // Step with two new detections that overlap each track slightly.
    const stepped = stepTracker(
      state,
      [
        detection({ box: box(0.12, 0.12, 0.32, 0.32) }),
        detection({ box: box(0.62, 0.62, 0.82, 0.82) }),
      ],
      config,
    );

    // Both tracks matched and visible, not one, not three.
    expect(stepped.state.tracks).toHaveLength(2);
    expect(stepped.visible).toHaveLength(2);

    // Each track should have adopted the correct detection's box.
    const track1 = stepped.visible.find(
      (t) => t.box.xmin > 0.1 && t.box.xmin < 0.15,
    );
    const track2 = stepped.visible.find(
      (t) => t.box.xmin > 0.6 && t.box.xmin < 0.65,
    );
    expect(track1).toBeDefined();
    expect(track2).toBeDefined();
    expect(track1?.box.xmin).toBeCloseTo(0.12);
    expect(track2?.box.xmin).toBeCloseTo(0.62);
  });

  it("does not force-match a detection when IoU falls below threshold", () => {
    let state = initialTrackerState();

    // Establish a track at box(0.4, 0.5, 0.6, 0.8).
    state = stepTracker(
      state,
      [detection({ box: box(0.4, 0.5, 0.6, 0.8) })],
      config,
    ).state;

    // Step with a non-overlapping detection at box(0.0, 0.0, 0.1, 0.1).
    // IoU is 0, well below the threshold (0.3).
    const stepped = stepTracker(
      state,
      [detection({ box: box(0.0, 0.0, 0.1, 0.1) })],
      config,
    );

    // The existing track was not matched so it coasts; the non-overlapping
    // detection spawns its own new track instead of stealing the old one.
    // Both are visible (each detection registers immediately).
    expect(stepped.state.tracks).toHaveLength(2);
    expect(stepped.visible).toHaveLength(2);

    const coasted = stepped.visible.find((t) => t.box.xmin > 0.35);
    const fresh = stepped.visible.find((t) => t.box.xmin < 0.05);
    expect(coasted?.box.xmin).toBeCloseTo(0.4);
    expect(fresh?.box.xmin).toBeCloseTo(0.0);
  });

  it("lets only one of two overlapping detections claim the same track", () => {
    let state = initialTrackerState();

    // Establish a single track at box(0.4, 0.4, 0.6, 0.6).
    state = stepTracker(
      state,
      [detection({ box: box(0.4, 0.4, 0.6, 0.6) })],
      config,
    ).state;

    // Step with two detections that both overlap the same existing track
    // above the IoU threshold. Without the greedy matcher's claimed[] guard,
    // both would match the same track instead of only one.
    const stepped = stepTracker(
      state,
      [
        detection({ box: box(0.42, 0.42, 0.62, 0.62) }),
        detection({ box: box(0.38, 0.38, 0.58, 0.58) }),
      ],
      config,
    );

    // One detection matched the existing track; the other spawned a new track
    // instead of also claiming it. Two tracks total, not one merged.
    expect(stepped.state.tracks).toHaveLength(2);
    expect(stepped.visible).toHaveLength(2);
  });
});

describe("createDetectionTracker", () => {
  it("holds state across update calls", () => {
    const tracker = createDetectionTracker(config);
    // First sighting is shown immediately.
    expect(tracker.update([detection()])).toHaveLength(1);
    // A frame with no detection still coasts the track (anti-flicker).
    expect(tracker.update([])).toHaveLength(1);
  });
});
