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

  it("matches two detections to two separate tracks greedily without double-claiming", () => {
    let state = initialTrackerState();

    // Create and confirm first track at top-left box.
    state = stepTracker(
      state,
      [detection({ box: box(0.1, 0.1, 0.3, 0.3) })],
      0,
      config,
    ).state;
    state = stepTracker(
      state,
      [detection({ box: box(0.1, 0.1, 0.3, 0.3) })],
      500,
      config,
    ).state;

    // Create and confirm second track at bottom-right box.
    state = stepTracker(
      state,
      [
        detection({ box: box(0.1, 0.1, 0.3, 0.3) }),
        detection({ box: box(0.6, 0.6, 0.8, 0.8) }),
      ],
      500,
      config,
    ).state;
    state = stepTracker(
      state,
      [
        detection({ box: box(0.1, 0.1, 0.3, 0.3) }),
        detection({ box: box(0.6, 0.6, 0.8, 0.8) }),
      ],
      1000,
      config,
    ).state;

    // Both tracks are now confirmed. Step with two new detections
    // that overlap each track slightly.
    const stepped = stepTracker(
      state,
      [
        detection({ box: box(0.12, 0.12, 0.32, 0.32) }),
        detection({ box: box(0.62, 0.62, 0.82, 0.82) }),
      ],
      1100,
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

    // Create and confirm a track at box(0.4, 0.5, 0.6, 0.8).
    state = stepTracker(
      state,
      [detection({ box: box(0.4, 0.5, 0.6, 0.8) })],
      0,
      config,
    ).state;
    state = stepTracker(
      state,
      [detection({ box: box(0.4, 0.5, 0.6, 0.8) })],
      500,
      config,
    ).state;

    // Step with a non-overlapping detection at box(0.0, 0.0, 0.1, 0.1).
    // IoU is 0, well below the threshold (0.3).
    const stepped = stepTracker(
      state,
      [detection({ box: box(0.0, 0.0, 0.1, 0.1) })],
      600,
      config,
    );

    // The confirmed track was not matched so it coasts (still visible, misses +1).
    // The non-overlapping detection spawns a new pending track.
    expect(stepped.state.tracks).toHaveLength(2);
    expect(stepped.visible).toHaveLength(1);

    // The visible track is the confirmed one that coasted.
    expect(stepped.visible[0].box.xmin).toBeCloseTo(0.4);
    expect(stepped.visible[0].box.ymin).toBeCloseTo(0.5);

    // The second track in state is the new pending one at the non-overlapping box.
    const pendingTrack = stepped.state.tracks.find((t) => !t.confirmed);
    expect(pendingTrack).toBeDefined();
    expect(pendingTrack?.box.xmin).toBeCloseTo(0.0);
  });

  it("lets only one of two overlapping detections claim the same confirmed track", () => {
    let state = initialTrackerState();

    // Create and confirm a single track at box(0.4, 0.4, 0.6, 0.6).
    state = stepTracker(
      state,
      [detection({ box: box(0.4, 0.4, 0.6, 0.6) })],
      0,
      config,
    ).state;
    state = stepTracker(
      state,
      [detection({ box: box(0.4, 0.4, 0.6, 0.6) })],
      500,
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
      1000,
      config,
    );

    // One detection matched the existing track; the other spawned a new
    // pending track instead of also claiming it.
    expect(stepped.state.tracks).toHaveLength(2);
    // Only the original confirmed track is visible; the new one is pending.
    expect(stepped.visible).toHaveLength(1);
  });
});

describe("createDetectionTracker", () => {
  it("holds state across update calls", () => {
    const tracker = createDetectionTracker(config);
    expect(tracker.update([detection()], 0)).toHaveLength(0);
    expect(tracker.update([detection()], 500)).toHaveLength(1);
  });
});
