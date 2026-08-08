import type { Detection, IdentifiedDetection, NormalizedBox } from "@/types";
import { DEFAULT_TRACKER_CONFIG } from "./consts";
import type { BoxVelocity, Track, TrackerConfig, TrackerState } from "./types";

export * from "./consts";
export * from "./types";

/** Intersection-over-union of two normalized boxes; 0 when they do not overlap. */
export const iou = (a: NormalizedBox, b: NormalizedBox): number => {
  const overlapX = Math.max(
    0,
    Math.min(a.xmax, b.xmax) - Math.max(a.xmin, b.xmin),
  );
  const overlapY = Math.max(
    0,
    Math.min(a.ymax, b.ymax) - Math.max(a.ymin, b.ymin),
  );
  const intersection = overlapX * overlapY;
  const areaA = Math.max(0, a.xmax - a.xmin) * Math.max(0, a.ymax - a.ymin);
  const areaB = Math.max(0, b.xmax - b.xmin) * Math.max(0, b.ymax - b.ymin);
  const union = areaA + areaB - intersection;
  return union > 0 ? intersection / union : 0;
};

export const initialTrackerState = (): TrackerState => ({
  tracks: [],
});

const zeroVelocity = (): BoxVelocity => ({
  centerX: 0,
  centerY: 0,
  width: 0,
  height: 0,
});

/** A corner box as center plus size, the frame velocity is expressed in. */
const boxGeometry = (box: NormalizedBox) => ({
  centerX: (box.xmin + box.xmax) / 2,
  centerY: (box.ymin + box.ymax) / 2,
  width: box.xmax - box.xmin,
  height: box.ymax - box.ymin,
});

const measureVelocity = (
  from: NormalizedBox,
  to: NormalizedBox,
  elapsedMs: number,
): BoxVelocity => {
  const a = boxGeometry(from);
  const b = boxGeometry(to);
  return {
    centerX: (b.centerX - a.centerX) / elapsedMs,
    centerY: (b.centerY - a.centerY) / elapsedMs,
    width: (b.width - a.width) / elapsedMs,
    height: (b.height - a.height) / elapsedMs,
  };
};

/**
 * Where a track's box should be at `atMs`, extrapolating its velocity from
 * where it was last seen. Matching scores detections against this box rather
 * than the stale one: at the pacing cadence a vehicle with real relative speed
 * moves far enough between scans that its old box may not overlap its new one
 * at all. A box shrinking through extrapolation clamps at zero size (its IoU
 * with anything is then 0) rather than inverting.
 */
export const predictBox = (track: Track, atMs: number): NormalizedBox => {
  const elapsed = atMs - track.lastSeenAt;
  const { centerX, centerY, width, height } = boxGeometry(track.box);
  const { velocity } = track;
  const predictedWidth = Math.max(0, width + velocity.width * elapsed);
  const predictedHeight = Math.max(0, height + velocity.height * elapsed);
  const predictedCenterX = centerX + velocity.centerX * elapsed;
  const predictedCenterY = centerY + velocity.centerY * elapsed;
  return {
    xmin: predictedCenterX - predictedWidth / 2,
    ymin: predictedCenterY - predictedHeight / 2,
    xmax: predictedCenterX + predictedWidth / 2,
    ymax: predictedCenterY + predictedHeight / 2,
  };
};

/**
 * How well a detection fits a track: the stronger of two signals, overlap
 * with the track's predicted box and nearness to its center. Overlap is the
 * precise signal, but a second of displacement can leave the true match with
 * little or none, and an IoU of 0 cannot even rank the closer of two
 * candidates; nearness, scaled by box size, keeps the score informative
 * there. Taking the max keeps both in [0, 1] under one threshold.
 */
const pairScore = (
  predicted: NormalizedBox,
  detection: NormalizedBox,
  config: TrackerConfig,
): number => {
  const overlap = iou(predicted, detection);
  const p = boxGeometry(predicted);
  const d = boxGeometry(detection);
  const distance = Math.hypot(d.centerX - p.centerX, d.centerY - p.centerY);
  const scale =
    (Math.hypot(p.width, p.height) + Math.hypot(d.width, d.height)) / 2;
  const reach = config.proximityRadiusDiagonals * scale;
  const proximity =
    reach > 0
      ? config.proximityScoreCeiling * Math.max(0, 1 - distance / reach)
      : 0;
  return Math.max(overlap, proximity);
};

/**
 * The score a candidate must beat to match a track unseen for `unseenMs`: the
 * full threshold within one floor-cadence scan, sliding linearly to the gate
 * floor by the pacing cap. The predicted box a candidate is scored against
 * gets less certain the longer it extrapolates, so a fixed gate rejects
 * exactly the matches a long gap still permits.
 */
const matchGateAt = (unseenMs: number, config: TrackerConfig): number => {
  const {
    iouMatchThreshold,
    matchGateFloor,
    matchGateTightMs,
    matchGateLooseMs,
  } = config;
  if (unseenMs <= matchGateTightMs) {
    return iouMatchThreshold;
  }
  if (unseenMs >= matchGateLooseMs) {
    return matchGateFloor;
  }
  const progress =
    (unseenMs - matchGateTightMs) / (matchGateLooseMs - matchGateTightMs);
  return iouMatchThreshold + (matchGateFloor - iouMatchThreshold) * progress;
};

/**
 * One frame of the coasting tracker: match this frame's detections to
 * same-class tracks by pair score, show every detection immediately, and coast
 * an unmatched track for up to `maxCoastMs` so its box does not flicker off
 * through a brief miss.
 * `identified` is the input detections in order, each carrying the id of the
 * track it matched or the fresh one it spawned; `tracks` adds the coasted set.
 */
export const stepTracker = (
  state: TrackerState,
  detections: Detection[],
  config: TrackerConfig,
  atMs: number,
): {
  state: TrackerState;
  identified: IdentifiedDetection[];
  tracks: Track[];
} => {
  const { tracks } = state;

  // Every viable track/detection pair, scored up front, then claimed from the
  // strongest pair down. Greedy-in-detection-order let an early detection take
  // a track a later detection fit better, and that misassignment gets more
  // likely as the scan gap grows and boxes drift apart between results.
  const candidates: Array<{
    trackIndex: number;
    detectionIndex: number;
    score: number;
  }> = [];
  const predicted = tracks.map((track) => predictBox(track, atMs));
  for (let t = 0; t < tracks.length; t += 1) {
    for (let d = 0; d < detections.length; d += 1) {
      // Same class only: identity means the same object still there, and an
      // object does not change class. A different-class box in the same place
      // is a new contact, not this one relabeled.
      if (tracks[t].label !== detections[d].label) {
        continue;
      }
      const score = pairScore(predicted[t], detections[d].box, config);
      if (score >= matchGateAt(atMs - tracks[t].lastSeenAt, config)) {
        candidates.push({ trackIndex: t, detectionIndex: d, score });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const trackClaimed = new Array<boolean>(tracks.length).fill(false);
  const detectionClaimed = new Array<boolean>(detections.length).fill(false);
  const matchedDetByTrack = new Map<number, Detection>();
  /** Index of the track each detection matched, aligned with `detections`. */
  const matchByDetection = new Array<number>(detections.length).fill(-1);
  for (const { trackIndex, detectionIndex } of candidates) {
    if (trackClaimed[trackIndex] || detectionClaimed[detectionIndex]) {
      continue;
    }
    trackClaimed[trackIndex] = true;
    detectionClaimed[detectionIndex] = true;
    matchByDetection[detectionIndex] = trackIndex;
    matchedDetByTrack.set(trackIndex, detections[detectionIndex]);
  }

  const nextTracks: Track[] = [];
  for (let i = 0; i < tracks.length; i += 1) {
    const track = tracks[i];
    const detection = matchedDetByTrack.get(i);
    if (detection) {
      // Ease toward the new score, so model jitter does not whipsaw the
      // readouts. Matching is class-gated, so the blend never crosses classes.
      const score =
        track.score +
        (detection.score - track.score) * config.scoreSmoothingAlpha;
      const elapsed = atMs - track.lastSeenAt;
      nextTracks.push({
        ...track,
        score,
        box: detection.box,
        velocity:
          elapsed > 0
            ? measureVelocity(track.box, detection.box, elapsed)
            : track.velocity,
        // The latest sighting's word, not the birth one: a vehicle seen as a
        // car and then a truck should read as what the model says now.
        rawLabel: detection.rawLabel,
        lastSeenAt: atMs,
      });
    } else if (atMs - track.lastSeenAt <= config.maxCoastMs) {
      // Coasting: keep the stale box and score. There is no detection this
      // frame to refresh either from.
      nextTracks.push(track);
    }
    // Past the coast budget: dropped.
  }

  const identified: IdentifiedDetection[] = [];
  for (let i = 0; i < detections.length; i += 1) {
    const detection = detections[i];
    const matched = matchByDetection[i];
    if (matched >= 0) {
      // The raw score, not the track's eased one: identity is the only
      // enrichment here, and smoothing stays a presentation concern.
      const { id, color } = tracks[matched];
      identified.push({ ...detection, id, color });
      continue;
    }
    const id = config.mintId();
    const color = config.mintColor(id);
    identified.push({ ...detection, id, color });
    nextTracks.push({
      id,
      color,
      label: detection.label,
      score: detection.score,
      box: detection.box,
      rawLabel: detection.rawLabel,
      lastSeenAt: atMs,
      velocity: zeroVelocity(),
    });
  }

  return { state: { tracks: nextTracks }, identified, tracks: nextTracks };
};

/**
 * The tracks a detection actually matched at `atMs`, dropping the coasted ones.
 * The meter and the contact card want the full set; a consumer drawing where
 * something stands right now wants this one, since a held track is a claim the
 * latest scan does not support.
 */
export const tracksSeenAt = (tracks: Track[], atMs: number): Track[] =>
  tracks.filter((track) => track.lastSeenAt === atMs);

/**
 * Stateful wrapper holding tracker state across frames. `update` returns the
 * frame's detections with their assigned ids, and the tracks to render (this
 * frame's plus any coasting), each keeping its id for as long as it lives.
 */
export const createDetectionTracker = (
  config: TrackerConfig = DEFAULT_TRACKER_CONFIG,
) => {
  let state = initialTrackerState();
  return {
    update: (
      detections: Detection[],
      atMs: number,
    ): { identified: IdentifiedDetection[]; tracks: Track[] } => {
      const result = stepTracker(state, detections, config, atMs);
      state = result.state;
      return { identified: result.identified, tracks: result.tracks };
    },
  };
};
