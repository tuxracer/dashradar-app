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

/** Strip a track's bookkeeping fields back to a plain Detection. */
const toDetection = (track: Track): Detection => ({
  label: track.label,
  displayLabel: track.displayLabel,
  category: track.category,
  score: track.score,
  box: track.box,
});

/**
 * One frame of the persistence gate. Greedily matches this frame's detections
 * to existing tracks by IoU, ages the matches toward confirmation, coasts
 * confirmed misses, drops pending misses, and returns the confirmed (visible)
 * detections. Pure: all time comes in via `nowMs`, all tuning via `config`.
 */
export const stepTracker = (
  state: TrackerState,
  detections: Detection[],
  nowMs: number,
  config: TrackerConfig,
): { state: TrackerState; visible: Detection[] } => {
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
      const confirmed =
        track.confirmed || nowMs - track.firstSeenMs >= config.persistMs;
      nextTracks.push({
        ...track,
        label: detection.label,
        displayLabel: detection.displayLabel,
        category: detection.category,
        score: detection.score,
        box: detection.box,
        misses: 0,
        confirmed,
      });
    } else if (track.confirmed) {
      const misses = track.misses + 1;
      if (misses <= config.maxMisses) {
        nextTracks.push({ ...track, misses });
      }
      // Beyond maxMisses: dropped.
    }
    // Unmatched pending track: dropped. A pending track must be matched every
    // frame to reach confirmation, which is what suppresses single-frame blips.
  }

  let nextId = state.nextId;
  for (const detection of unmatched) {
    nextTracks.push({
      id: nextId,
      label: detection.label,
      displayLabel: detection.displayLabel,
      category: detection.category,
      score: detection.score,
      box: detection.box,
      firstSeenMs: nowMs,
      confirmed: false,
      misses: 0,
    });
    nextId += 1;
  }

  const visible = nextTracks
    .filter((track) => track.confirmed)
    .map(toDetection);
  return { state: { tracks: nextTracks, nextId }, visible };
};

/**
 * Stateful wrapper that holds tracker state across frames. The context keeps
 * one instance in a ref and calls `update` with each frame's detections and the
 * current `performance.now()`; it returns the confirmed detections to render.
 */
export const createDetectionTracker = (
  config: TrackerConfig = DEFAULT_TRACKER_CONFIG,
) => {
  let state = initialTrackerState();
  return {
    update: (detections: Detection[], nowMs: number): Detection[] => {
      const result = stepTracker(state, detections, nowMs, config);
      state = result.state;
      return result.visible;
    },
  };
};
