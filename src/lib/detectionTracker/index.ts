import type { Detection, NormalizedBox } from "@/types";
import { DEFAULT_TRACKER_CONFIG } from "./consts";
import type { Track, TrackerConfig, TrackerState } from "./types";

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

/** Empty starting state for a tracker. */
export const initialTrackerState = (): TrackerState => ({
  tracks: [],
  nextId: 0,
});

/**
 * One frame of the coasting tracker: greedily match this frame's detections to
 * existing tracks by IoU, show every detection immediately, and coast an
 * unmatched track for up to `maxCoastMs` so its box does not flicker off when
 * the model briefly loses the object. The budget is elapsed time rather than a
 * count of results, because results arrive at whatever cadence the pacing
 * chooses and a coasting track holds its full score: a count would keep a
 * vanished vehicle driving the alert far longer on a slow device.
 */
export const stepTracker = (
  state: TrackerState,
  detections: Detection[],
  config: TrackerConfig,
  atMs: number,
): { state: TrackerState; visible: Track[] } => {
  const { tracks } = state;
  const claimed = new Array<boolean>(tracks.length).fill(false);
  const matchedDetByTrack = new Map<number, Detection>();
  const unmatched: Detection[] = [];

  // Associate each detection with the best available track above the IoU bar.
  for (const detection of detections) {
    let bestIndex = -1;
    let bestIou = -1;
    for (let i = 0; i < tracks.length; i += 1) {
      if (claimed[i]) {
        continue;
      }
      const value = iou(tracks[i].box, detection.box);
      if (value > bestIou) {
        bestIou = value;
        bestIndex = i;
      }
    }
    if (bestIndex >= 0 && bestIou >= config.iouMatchThreshold) {
      claimed[bestIndex] = true;
      matchedDetByTrack.set(bestIndex, detection);
    } else {
      unmatched.push(detection);
    }
  }

  const nextTracks: Track[] = [];
  for (let i = 0; i < tracks.length; i += 1) {
    const track = tracks[i];
    const detection = matchedDetByTrack.get(i);
    if (detection) {
      // Ease toward the new score rather than adopting it, so per-frame model
      // jitter does not whipsaw the readouts. Not across a label change, though:
      // matching is purely by box overlap, so the eased score describes the old
      // class and blending it would leak that confidence into the new one.
      const score =
        detection.label === track.label
          ? track.score +
            (detection.score - track.score) * config.scoreSmoothingAlpha
          : detection.score;
      nextTracks.push({
        ...track,
        label: detection.label,
        score,
        box: detection.box,
        lastSeenAt: atMs,
      });
    } else if (atMs - track.lastSeenAt <= config.maxCoastMs) {
      // Coasting: keep the stale box and score. There is no detection this
      // frame to refresh either from.
      nextTracks.push(track);
    }
    // Past the coast budget: dropped.
  }

  let nextId = state.nextId;
  for (const detection of unmatched) {
    nextTracks.push({
      id: nextId,
      label: detection.label,
      score: detection.score,
      box: detection.box,
      lastSeenAt: atMs,
    });
    nextId += 1;
  }

  return { state: { tracks: nextTracks, nextId }, visible: nextTracks };
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
 * tracks to render, this frame's plus any coasting, each carrying the stable id
 * it keeps for as long as it lives.
 */
export const createDetectionTracker = (
  config: TrackerConfig = DEFAULT_TRACKER_CONFIG,
) => {
  let state = initialTrackerState();
  return {
    update: (detections: Detection[], atMs: number): Track[] => {
      const result = stepTracker(state, detections, config, atMs);
      state = result.state;
      return result.visible;
    },
  };
};
