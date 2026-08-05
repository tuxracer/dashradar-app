import { describe, expect, it } from "vitest";
import type { Detection, NormalizedBox } from "@/types";
import {
  createDetectionTracker,
  initialTrackerState,
  iou,
  stepTracker,
  tracksSeenAt,
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
  score: 0.9,
  box: box(0.4, 0.5, 0.6, 0.8),
  ...overrides,
});

const config: TrackerConfig = {
  iouMatchThreshold: 0.3,
  maxCoastMs: 2_500,
  scoreSmoothingAlpha: 0.5,
};

/** Result cadence at the pacing floor: one result per second. */
const FLOOR_CADENCE_MS = 1_000;

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
      0,
    );
    expect(visible).toHaveLength(1);
    expect(visible[0].label).toBe("police");
  });

  it("coasts a track through brief misses at the floor cadence, then drops it", () => {
    let state = initialTrackerState();
    const shown = stepTracker(state, [detection()], config, 0);
    expect(shown.visible).toHaveLength(1);
    state = shown.state;
    // Misses at 1 s and 2 s: inside the coast budget, still visible.
    const miss1 = stepTracker(state, [], config, FLOOR_CADENCE_MS);
    expect(miss1.visible).toHaveLength(1);
    const miss2 = stepTracker(miss1.state, [], config, 2 * FLOOR_CADENCE_MS);
    expect(miss2.visible).toHaveLength(1);
    // 3 s: past the budget, dropped.
    const miss3 = stepTracker(miss2.state, [], config, 3 * FLOOR_CADENCE_MS);
    expect(miss3.visible).toHaveLength(0);
    expect(miss3.state.tracks).toHaveLength(0);
  });

  it("drops a stale track once its coast time is spent, however few results arrived", () => {
    // Results 5 s apart, the pacing cap's cadence on a hot throttled device.
    // Counting missed results instead of time would hold the stale full-score
    // track (and the alert behind it) through two of these gaps, stretching
    // the beeper ~5x past what the same miss costs at the floor cadence.
    let state = initialTrackerState();
    state = stepTracker(state, [detection()], config, 0).state;
    const missed = stepTracker(state, [], config, 5_000);
    expect(missed.visible).toHaveLength(0);
    expect(missed.state.tracks).toHaveLength(0);
  });

  it("measures the coast budget from the last match, not the track's birth", () => {
    let state = initialTrackerState();
    state = stepTracker(state, [detection()], config, 0).state;
    // Re-matched at 4 s: the budget restarts from there.
    state = stepTracker(state, [detection()], config, 4_000).state;
    const missed = stepTracker(state, [], config, 6_000);
    expect(missed.visible).toHaveLength(1);
  });

  it("keeps one track as its box drifts across frames (IoU match)", () => {
    let state = initialTrackerState();
    state = stepTracker(
      state,
      [detection({ box: box(0.4, 0.5, 0.6, 0.8) })],
      config,
      0,
    ).state;
    const drifted = stepTracker(
      state,
      [detection({ box: box(0.42, 0.52, 0.62, 0.82) })],
      config,
      FLOOR_CADENCE_MS,
    );
    expect(drifted.state.tracks).toHaveLength(1);
    expect(drifted.visible).toHaveLength(1);
  });

  it("adopts a matched detection's box outright but eases its score by scoreSmoothingAlpha", () => {
    let state = initialTrackerState();
    state = stepTracker(state, [detection({ score: 0.8 })], config, 0).state;
    const updated = stepTracker(
      state,
      [detection({ score: 0.95, box: box(0.41, 0.51, 0.61, 0.81) })],
      config,
      FLOOR_CADENCE_MS,
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
    state = stepTracker(state, [detection({ score: 0.94 })], config, 0).state;
    const shown: number[] = [];
    let at = 0;
    for (const raw of [0.76, 0.94, 0.76, 0.94]) {
      at += FLOOR_CADENCE_MS;
      const stepped = stepTracker(
        state,
        [detection({ score: raw })],
        config,
        at,
      );
      state = stepped.state;
      shown.push(stepped.visible[0].score);
    }
    const swings = shown.slice(1).map((score, i) => Math.abs(score - shown[i]));
    expect(Math.max(...swings)).toBeLessThan(0.18 / 2 + 0.001);
  });

  it("adopts the raw score outright when scoreSmoothingAlpha is 1", () => {
    const unsmoothed: TrackerConfig = { ...config, scoreSmoothingAlpha: 1 };
    let state = initialTrackerState();
    state = stepTracker(
      state,
      [detection({ score: 0.8 })],
      unsmoothed,
      0,
    ).state;
    const updated = stepTracker(
      state,
      [detection({ score: 0.95 })],
      unsmoothed,
      FLOOR_CADENCE_MS,
    );
    expect(updated.visible[0].score).toBe(0.95);
  });

  it("adopts the new detection's raw score outright when the matched label changes, instead of easing from the old class's score", () => {
    // A POLICE track eases up to a high score.
    let state = initialTrackerState();
    state = stepTracker(
      state,
      [detection({ label: "police", score: 0.95 })],
      config,
      0,
    ).state;
    // Next frame the model reports a PERSON, not a POLICE, in an overlapping
    // box. They match by IoU (stepTracker never checks label), but the score
    // that was eased for POLICE describes nothing about this PERSON.
    const stepped = stepTracker(
      state,
      [
        detection({
          label: "person",
          score: 0.55,
        }),
      ],
      config,
      FLOOR_CADENCE_MS,
    );
    // The visible score must be the new detection's own value, not a blend
    // of the stale POLICE confidence (0.95) and the new PERSON score (which
    // alpha 0.5 would put at 0.75).
    expect(stepped.visible[0].label).toBe("person");
    expect(stepped.visible[0].score).toBe(0.55);
  });

  it("shows a brand-new track's first score unsmoothed", () => {
    const { visible } = stepTracker(
      initialTrackerState(),
      [detection({ score: 0.91 })],
      config,
      0,
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
      0,
    ).state;

    // Step with two new detections that overlap each track slightly.
    const stepped = stepTracker(
      state,
      [
        detection({ box: box(0.12, 0.12, 0.32, 0.32) }),
        detection({ box: box(0.62, 0.62, 0.82, 0.82) }),
      ],
      config,
      FLOOR_CADENCE_MS,
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
      0,
    ).state;

    // Step with a non-overlapping detection at box(0.0, 0.0, 0.1, 0.1).
    // IoU is 0, well below the threshold (0.3).
    const stepped = stepTracker(
      state,
      [detection({ box: box(0.0, 0.0, 0.1, 0.1) })],
      config,
      FLOOR_CADENCE_MS,
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
      0,
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
      FLOOR_CADENCE_MS,
    );

    // One detection matched the existing track; the other spawned a new track
    // instead of also claiming it. Two tracks total, not one merged.
    expect(stepped.state.tracks).toHaveLength(2);
    expect(stepped.visible).toHaveLength(2);
  });
});

describe("tracksSeenAt", () => {
  it("keeps a track the scan matched and drops one the tracker is coasting", () => {
    const tracker = createDetectionTracker(config);
    const stayer = box(0.4, 0.5, 0.6, 0.8);
    const leaver = box(0.0, 0.0, 0.15, 0.15);
    tracker.update([detection({ box: stayer }), detection({ box: leaver })], 0);
    // Second scan finds only one of them. The tracker still reports both,
    // because the other is inside its coasting budget.
    const coasted = tracker.update(
      [detection({ box: stayer })],
      FLOOR_CADENCE_MS,
    );
    expect(coasted).toHaveLength(2);

    const seen = tracksSeenAt(coasted, FLOOR_CADENCE_MS);
    expect(seen).toHaveLength(1);
    expect(seen[0].box).toEqual(stayer);
  });

  it("keeps every track while the scan is still finding them all", () => {
    const tracker = createDetectionTracker(config);
    const first = box(0.4, 0.5, 0.6, 0.8);
    const second = box(0.0, 0.0, 0.15, 0.15);
    tracker.update([detection({ box: first }), detection({ box: second })], 0);
    const both = tracker.update(
      [detection({ box: first }), detection({ box: second })],
      FLOOR_CADENCE_MS,
    );
    expect(tracksSeenAt(both, FLOOR_CADENCE_MS)).toHaveLength(2);
  });

  it("drops everything on a scan that found nothing at all", () => {
    const tracker = createDetectionTracker(config);
    tracker.update([detection()], 0);
    const coasted = tracker.update([], FLOOR_CADENCE_MS);
    expect(coasted).toHaveLength(1);
    expect(tracksSeenAt(coasted, FLOOR_CADENCE_MS)).toHaveLength(0);
  });
});

describe("createDetectionTracker", () => {
  it("holds state across update calls", () => {
    const tracker = createDetectionTracker(config);
    // First sighting is shown immediately.
    expect(tracker.update([detection()], 0)).toHaveLength(1);
    // A prompt empty result still coasts the track (anti-flicker).
    expect(tracker.update([], FLOOR_CADENCE_MS)).toHaveLength(1);
  });

  it("drops a stale track by elapsed time under the default tuning", () => {
    const tracker = createDetectionTracker();
    expect(tracker.update([detection()], 0)).toHaveLength(1);
    // One empty result 5 s later, the pacing cap's cadence: a results-counted
    // coast would still show the stale track here; the time budget does not.
    expect(tracker.update([], 5_000)).toHaveLength(0);
  });

  it("keeps a matched object's id stable across update calls", () => {
    const tracker = createDetectionTracker(config);
    const [first] = tracker.update(
      [detection({ box: box(0.4, 0.5, 0.6, 0.8) })],
      0,
    );
    // The next frame's box drifts but matches by IoU: same object, same id.
    const [second] = tracker.update(
      [detection({ box: box(0.42, 0.52, 0.62, 0.82) })],
      FLOOR_CADENCE_MS,
    );
    expect(second.id).toBe(first.id);
  });

  it("assigns a new object its own id", () => {
    const tracker = createDetectionTracker(config);
    const [first] = tracker.update(
      [detection({ box: box(0.4, 0.5, 0.6, 0.8) })],
      0,
    );
    // A detection far from the existing track spawns a fresh track; the
    // established one keeps its id and the newcomer gets a different one.
    const tracks = tracker.update(
      [
        detection({ box: box(0.42, 0.52, 0.62, 0.82) }),
        detection({ box: box(0.0, 0.0, 0.1, 0.1) }),
      ],
      FLOOR_CADENCE_MS,
    );
    const matched = tracks.find((track) => track.box.xmin > 0.3);
    const fresh = tracks.find((track) => track.box.xmin < 0.3);
    expect(matched?.id).toBe(first.id);
    expect(fresh?.id).toBeDefined();
    expect(fresh?.id).not.toBe(first.id);
  });
});
