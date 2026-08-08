import { describe, expect, it } from "vitest";
import type { Detection, NormalizedBox } from "@/types";
import {
  createDetectionTracker,
  initialTrackerState,
  iou,
  predictBox,
  stepTracker,
  tracksSeenAt,
  type Track,
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

/** Deterministic ids, so a test can assert on relationships without stubbing. */
const testConfig = (): TrackerConfig => {
  let minted = 0;
  return {
    iouMatchThreshold: 0.3,
    proximityScoreCeiling: 0.6,
    proximityRadiusDiagonals: 2,
    matchGateFloor: 0.15,
    matchGateTightMs: 1_000,
    matchGateLooseMs: 5_000,
    maxCoastMs: 2_500,
    scoreSmoothingAlpha: 0.5,
    mintId: () => `id-${(minted += 1)}`,
    mintColor: (id) => `color-${id}`,
  };
};

const config = testConfig();

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
    const { tracks } = stepTracker(
      initialTrackerState(),
      [detection()],
      config,
      0,
    );
    expect(tracks).toHaveLength(1);
    expect(tracks[0].label).toBe("police");
  });

  it("coasts a track through brief misses at the floor cadence, then drops it", () => {
    let state = initialTrackerState();
    const shown = stepTracker(state, [detection()], config, 0);
    expect(shown.tracks).toHaveLength(1);
    state = shown.state;
    // Misses at 1 s and 2 s: inside the coast budget, still visible.
    const miss1 = stepTracker(state, [], config, FLOOR_CADENCE_MS);
    expect(miss1.tracks).toHaveLength(1);
    const miss2 = stepTracker(miss1.state, [], config, 2 * FLOOR_CADENCE_MS);
    expect(miss2.tracks).toHaveLength(1);
    // 3 s: past the budget, dropped.
    const miss3 = stepTracker(miss2.state, [], config, 3 * FLOOR_CADENCE_MS);
    expect(miss3.tracks).toHaveLength(0);
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
    expect(missed.tracks).toHaveLength(0);
    expect(missed.state.tracks).toHaveLength(0);
  });

  it("measures the coast budget from the last match, not the track's birth", () => {
    let state = initialTrackerState();
    state = stepTracker(state, [detection()], config, 0).state;
    // Re-matched at 4 s: the budget restarts from there.
    state = stepTracker(state, [detection()], config, 4_000).state;
    const missed = stepTracker(state, [], config, 6_000);
    expect(missed.tracks).toHaveLength(1);
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
    expect(drifted.tracks).toHaveLength(1);
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
    expect(updated.tracks[0].score).toBeCloseTo(0.875);
    expect(updated.tracks[0].box.xmin).toBeCloseTo(0.41);
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
      shown.push(stepped.tracks[0].score);
    }
    const swings = shown.slice(1).map((score, i) => Math.abs(score - shown[i]));
    expect(Math.max(...swings)).toBeLessThan(0.18 / 2 + 0.001);
  });

  it("adopts the raw score outright when scoreSmoothingAlpha is 1", () => {
    const unsmoothed: TrackerConfig = {
      ...testConfig(),
      scoreSmoothingAlpha: 1,
    };
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
    expect(updated.tracks[0].score).toBe(0.95);
  });

  it("gives an overlapping detection of a different class its own track", () => {
    // A POLICE track is established.
    let state = initialTrackerState();
    const first = stepTracker(
      state,
      [detection({ label: "police", score: 0.95 })],
      config,
      0,
    );
    state = first.state;
    // Next frame the model reports a PERSON in an overlapping box. Same place,
    // different class: a new object, never the police track relabeled.
    const stepped = stepTracker(
      state,
      [detection({ label: "person", score: 0.55 })],
      config,
      FLOOR_CADENCE_MS,
    );
    expect(stepped.tracks).toHaveLength(2);
    const person = stepped.tracks.find((track) => track.label === "person");
    const police = stepped.tracks.find((track) => track.label === "police");
    // The person carries its own fresh id and raw score; the police track
    // coasts unmatched behind it rather than adopting the person's box.
    expect(person?.id).toBeDefined();
    expect(person?.id).not.toBe(police?.id);
    expect(person?.score).toBe(0.55);
    expect(police?.lastSeenAt).toBe(0);
  });

  it("shows a brand-new track's first score unsmoothed", () => {
    const { tracks } = stepTracker(
      initialTrackerState(),
      [detection({ score: 0.91 })],
      config,
      0,
    );
    expect(tracks[0].score).toBe(0.91);
  });

  it("returns each detection with its assigned id, in input order", () => {
    let state = initialTrackerState();
    const first = stepTracker(
      state,
      [detection({ box: box(0.4, 0.5, 0.6, 0.8) })],
      config,
      0,
    );
    state = first.state;
    // A drifted re-detection plus a newcomer, newcomer listed first: each
    // identified entry sits at its own detection's index, so order survives.
    const stepped = stepTracker(
      state,
      [
        detection({ box: box(0.0, 0.0, 0.1, 0.1), score: 0.5 }),
        detection({ box: box(0.42, 0.52, 0.62, 0.82), score: 0.7 }),
      ],
      config,
      FLOOR_CADENCE_MS,
    );
    expect(stepped.identified).toHaveLength(2);
    expect(stepped.identified[1].id).toBe(first.identified[0].id);
    expect(stepped.identified[0].id).not.toBe(first.identified[0].id);
    // Identity is the only enrichment: the raw score passes through even
    // though the track behind the id smooths its own.
    expect(stepped.identified[1].score).toBe(0.7);
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
    expect(stepped.tracks).toHaveLength(2);

    // Each track should have adopted the correct detection's box.
    const track1 = stepped.tracks.find(
      (t) => t.box.xmin > 0.1 && t.box.xmin < 0.15,
    );
    const track2 = stepped.tracks.find(
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
    expect(stepped.tracks).toHaveLength(2);

    const coasted = stepped.tracks.find((t) => t.box.xmin > 0.35);
    const fresh = stepped.tracks.find((t) => t.box.xmin < 0.05);
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
    expect(stepped.tracks).toHaveLength(2);
  });

  it("gives a contested track to the best-fitting detection, not the first-listed one", () => {
    // One track, two same-class detections both above the gate, the weaker
    // fit listed first. Claiming in detection order hands the track (and its
    // id) to whichever detection the model happened to emit first; claiming
    // the best pair first keeps the id with the stronger fit.
    let state = initialTrackerState();
    const first = stepTracker(
      state,
      [detection({ box: box(0.4, 0.4, 0.6, 0.6) })],
      config,
      0,
    );
    state = first.state;
    const stepped = stepTracker(
      state,
      [
        detection({ box: box(0.45, 0.45, 0.65, 0.65) }), // IoU ~0.39
        detection({ box: box(0.41, 0.41, 0.61, 0.61) }), // IoU ~0.82
      ],
      config,
      FLOOR_CADENCE_MS,
    );
    expect(stepped.identified[1].id).toBe(first.identified[0].id);
    expect(stepped.identified[0].id).not.toBe(first.identified[0].id);
  });

  it("assigns contested tracks as a whole instead of letting an early detection force a swap", () => {
    // Two adjacent tracks. D0 overlaps both, fitting T2 a little better than
    // T1; D1 fits T2 strongly and T1 below the gate. Detection order lets D0
    // take T2 first, which orphans D1 into a fresh id and coasts T1 unmatched:
    // one real match dressed as a swap plus a phantom newcomer. Best pair
    // first settles both correctly: D1 keeps T2, D0 keeps T1.
    let state = initialTrackerState();
    const first = stepTracker(
      state,
      [
        detection({ box: box(0.1, 0.1, 0.3, 0.3) }), // T1
        detection({ box: box(0.24, 0.1, 0.44, 0.3) }), // T2
      ],
      config,
      0,
    );
    state = first.state;
    const [t1Id, t2Id] = [first.identified[0].id, first.identified[1].id];
    const stepped = stepTracker(
      state,
      [
        detection({ box: box(0.18, 0.1, 0.38, 0.3) }), // T1 ~0.43, T2 ~0.54
        detection({ box: box(0.25, 0.1, 0.45, 0.3) }), // T1 ~0.14, T2 ~0.90
      ],
      config,
      FLOOR_CADENCE_MS,
    );
    expect(stepped.identified[0].id).toBe(t1Id);
    expect(stepped.identified[1].id).toBe(t2Id);
    // Both tracks matched: nothing coasting, nothing minted.
    expect(stepped.state.tracks).toHaveLength(2);
  });

  it("keeps a steadily moving object's id across a missed scan by extrapolating its motion", () => {
    // A vehicle crossing at 0.09 frame-widths per second, seen at 0 s and 1 s
    // (learning its velocity), missed at 2 s, seen again at 3.5 s. By then it
    // has moved 0.225: essentially no overlap with the box where it was last
    // seen, so matching against the stale box mints a fresh id. Matching
    // against the box extrapolated per elapsed millisecond lands on it. A
    // per-result velocity fails here too: it would predict one result's worth
    // of motion (0.09) across a 2.5 s gap and still miss the overlap gate.
    let state = initialTrackerState();
    const first = stepTracker(
      state,
      [detection({ box: box(0.1, 0.4, 0.3, 0.6) })],
      config,
      0,
    );
    state = first.state;
    state = stepTracker(
      state,
      [detection({ box: box(0.19, 0.4, 0.39, 0.6) })],
      config,
      1_000,
    ).state;
    state = stepTracker(state, [], config, 2_000).state;
    const reacquired = stepTracker(
      state,
      [detection({ box: box(0.415, 0.4, 0.615, 0.6) })],
      config,
      3_500,
    );
    expect(reacquired.identified[0].id).toBe(first.identified[0].id);
    expect(reacquired.state.tracks).toHaveLength(1);
  });

  it("keeps a closing vehicle's id when its box balloons between scans", () => {
    // A vehicle being approached head-on: same center, but its box doubles in
    // each dimension across one scan gap. The IoU of the two boxes is 0.25,
    // under the match threshold, so overlap alone would mint a fresh id for
    // the same car. Dead-center nearness carries the match instead.
    let state = initialTrackerState();
    const first = stepTracker(
      state,
      [detection({ box: box(0.4, 0.4, 0.6, 0.6) })],
      config,
      0,
    );
    state = first.state;
    const closed = stepTracker(
      state,
      [detection({ box: box(0.3, 0.3, 0.7, 0.7) })],
      config,
      FLOOR_CADENCE_MS,
    );
    expect(closed.identified[0].id).toBe(first.identified[0].id);
    expect(closed.state.tracks).toHaveLength(1);
  });

  it("keeps an id across a displacement that leaves no overlap at all", () => {
    // Displaced by exactly one box width: zero overlap, but the boxes stand
    // shoulder to shoulder. IoU scores this 0, indistinguishable from a
    // detection across the frame; the nearness term ranks and matches it.
    let state = initialTrackerState();
    const first = stepTracker(
      state,
      [detection({ box: box(0.4, 0.4, 0.6, 0.6) })],
      config,
      0,
    );
    state = first.state;
    const shifted = stepTracker(
      state,
      [detection({ box: box(0.6, 0.4, 0.8, 0.6) })],
      config,
      FLOOR_CADENCE_MS,
    );
    expect(shifted.identified[0].id).toBe(first.identified[0].id);
    expect(shifted.state.tracks).toHaveLength(1);
  });

  it("accepts a weaker match for a track it has been coasting a while", () => {
    // A stationary track missed for 2.4 s, then a detection displaced 1.55
    // box widths: zero overlap and a nearness score of ~0.27, under the full
    // threshold. A fixed gate would mint a fresh id here; the gate relaxed
    // for 2.4 s unseen accepts it, because after that long a coast this is
    // exactly how far a real reacquisition can land from the stale fix.
    let state = initialTrackerState();
    const first = stepTracker(
      state,
      [detection({ box: box(0.4, 0.4, 0.6, 0.6) })],
      config,
      0,
    );
    state = first.state;
    state = stepTracker(
      state,
      [detection({ box: box(0.4, 0.4, 0.6, 0.6) })],
      config,
      1_000,
    ).state;
    state = stepTracker(state, [], config, 2_000).state;
    state = stepTracker(state, [], config, 3_000).state;
    const reacquired = stepTracker(
      state,
      [detection({ box: box(0.71, 0.4, 0.91, 0.6) })],
      config,
      3_400,
    );
    expect(reacquired.identified[0].id).toBe(first.identified[0].id);
    expect(reacquired.state.tracks).toHaveLength(1);
  });

  it("still demands the full threshold of a track seen one scan ago", () => {
    // Guard on the relaxing gate: the same 1.55-width displacement one
    // floor-cadence scan after the last sighting stays a fresh object. The
    // gate only loosens with unseen time, never at the cadence scans
    // normally arrive at.
    let state = initialTrackerState();
    const first = stepTracker(
      state,
      [detection({ box: box(0.4, 0.4, 0.6, 0.6) })],
      config,
      0,
    );
    state = first.state;
    state = stepTracker(
      state,
      [detection({ box: box(0.4, 0.4, 0.6, 0.6) })],
      config,
      1_000,
    ).state;
    const displaced = stepTracker(
      state,
      [detection({ box: box(0.71, 0.4, 0.91, 0.6) })],
      config,
      2_000,
    );
    expect(displaced.identified[0].id).not.toBe(first.identified[0].id);
    // The old track coasts behind the newcomer rather than being claimed.
    expect(displaced.state.tracks).toHaveLength(2);
  });

  it("does not invent motion for an object seen only once", () => {
    // Guard on the prediction branch: a newborn track has no velocity yet, so
    // its predicted box is the box it was seen in, and a far detection still
    // mints its own id instead of being pulled in.
    let state = initialTrackerState();
    const first = stepTracker(
      state,
      [detection({ box: box(0.1, 0.4, 0.3, 0.6) })],
      config,
      0,
    );
    state = first.state;
    const far = stepTracker(
      state,
      [detection({ box: box(0.5, 0.4, 0.7, 0.6) })],
      config,
      1_000,
    );
    expect(far.identified[0].id).not.toBe(first.identified[0].id);
  });
});

describe("predictBox", () => {
  const track = (overrides: Partial<Track>): Track => ({
    id: "id-track",
    color: "#123456",
    label: "vehicle",
    score: 0.9,
    box: box(0.4, 0.4, 0.6, 0.6),
    lastSeenAt: 0,
    velocity: { centerX: 0, centerY: 0, width: 0, height: 0 },
    ...overrides,
  });

  it("extrapolates center and size per elapsed millisecond", () => {
    const predicted = predictBox(
      track({
        velocity: { centerX: 0.0001, centerY: 0, width: 0.00004, height: 0 },
      }),
      2_000,
    );
    // Center moves 0.2 right; width grows 0.08, split across both edges.
    expect(predicted.xmin).toBeCloseTo(0.56);
    expect(predicted.xmax).toBeCloseTo(0.84);
    expect(predicted.ymin).toBeCloseTo(0.4);
    expect(predicted.ymax).toBeCloseTo(0.6);
  });

  it("clamps a shrinking box at zero size instead of inverting", () => {
    const predicted = predictBox(
      track({ velocity: { centerX: 0, centerY: 0, width: -0.001, height: 0 } }),
      1_000,
    );
    expect(predicted.xmax - predicted.xmin).toBe(0);
    expect(predicted.xmax).toBeCloseTo(0.5);
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
    ).tracks;
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
    ).tracks;
    expect(tracksSeenAt(both, FLOOR_CADENCE_MS)).toHaveLength(2);
  });

  it("drops everything on a scan that found nothing at all", () => {
    const tracker = createDetectionTracker(config);
    tracker.update([detection()], 0);
    const coasted = tracker.update([], FLOOR_CADENCE_MS).tracks;
    expect(coasted).toHaveLength(1);
    expect(tracksSeenAt(coasted, FLOOR_CADENCE_MS)).toHaveLength(0);
  });
});

describe("createDetectionTracker", () => {
  it("holds state across update calls", () => {
    const tracker = createDetectionTracker(config);
    // First sighting is shown immediately.
    expect(tracker.update([detection()], 0).tracks).toHaveLength(1);
    // A prompt empty result still coasts the track (anti-flicker).
    expect(tracker.update([], FLOOR_CADENCE_MS).tracks).toHaveLength(1);
  });

  it("drops a stale track by elapsed time under the default tuning", () => {
    const tracker = createDetectionTracker();
    expect(tracker.update([detection()], 0).tracks).toHaveLength(1);
    // One empty result 5 s later, the pacing cap's cadence: a results-counted
    // coast would still show the stale track here; the time budget does not.
    expect(tracker.update([], 5_000).tracks).toHaveLength(0);
  });

  it("keeps a matched object's id stable across update calls", () => {
    const tracker = createDetectionTracker(config);
    const [first] = tracker.update(
      [detection({ box: box(0.4, 0.5, 0.6, 0.8) })],
      0,
    ).tracks;
    // The next frame's box drifts but matches by IoU: same object, same id.
    const [second] = tracker.update(
      [detection({ box: box(0.42, 0.52, 0.62, 0.82) })],
      FLOOR_CADENCE_MS,
    ).tracks;
    expect(second.id).toBe(first.id);
  });

  it("assigns a new object its own id", () => {
    const tracker = createDetectionTracker(config);
    const [first] = tracker.update(
      [detection({ box: box(0.4, 0.5, 0.6, 0.8) })],
      0,
    ).tracks;
    // A detection far from the existing track spawns a fresh track; the
    // established one keeps its id and the newcomer gets a different one.
    const { tracks } = tracker.update(
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

  it("shows the latest sighting's raw word on a matched track, not the birth one", () => {
    const tracker = createDetectionTracker(testConfig());
    tracker.update([detection({ label: "vehicle", rawLabel: "car" })], 0);
    // Same object, but the model now calls it a truck: the track's identity
    // holds while its presentation word follows the current sighting.
    const { tracks } = tracker.update(
      [detection({ label: "vehicle", rawLabel: "truck" })],
      FLOOR_CADENCE_MS,
    );
    expect(tracks).toHaveLength(1);
    expect(tracks[0].rawLabel).toBe("truck");
  });

  it("keeps an object's color with its id and gives a newcomer its own", () => {
    const tracker = createDetectionTracker(testConfig());
    const first = tracker.update(
      [detection({ box: box(0.4, 0.5, 0.6, 0.8) })],
      0,
    );
    const again = tracker.update(
      [
        detection({ box: box(0.42, 0.52, 0.62, 0.82) }),
        detection({ box: box(0.0, 0.0, 0.1, 0.1) }),
      ],
      FLOOR_CADENCE_MS,
    );
    // The re-detected object carries the color minted at its first sighting;
    // the newcomer's differs because its id does.
    expect(again.identified[0].color).toBe(first.identified[0].color);
    expect(again.identified[1].color).not.toBe(first.identified[0].color);
  });

  it("mints distinct string ids and real CSS colors under the default config", () => {
    // The default mint is the platform GUID; what matters here is that two
    // objects never share one, not what the string looks like. The color is
    // asserted by shape because it goes straight into CSS.
    const tracker = createDetectionTracker();
    const { identified } = tracker.update(
      [
        detection({ box: box(0.1, 0.1, 0.3, 0.3) }),
        detection({ box: box(0.6, 0.6, 0.8, 0.8) }),
      ],
      0,
    );
    expect(identified[0].id).toEqual(expect.any(String));
    expect(identified[0].id).not.toBe(identified[1].id);
    expect(identified[0].color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
