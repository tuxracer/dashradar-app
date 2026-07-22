import type { TrackerConfig } from "./types";

/**
 * Minimum IoU for a detection to be matched to an existing track between
 * frames. Low enough to tolerate the box drift of a moving object and camera.
 * Tune on-device.
 */
export const IOU_MATCH_THRESHOLD = 0.3;

/**
 * Unmatched processed frames a track coasts before being dropped, so a box
 * does not flicker off when the model briefly loses it.
 */
export const MAX_MISSES = 2;

/**
 * Blend weight for a matched detection's score (see TrackerConfig). At the
 * detector's ~1 Hz cadence, 0.5 averages each pair of consecutive frames,
 * roughly halving raw score jitter before it reaches the HUD and the radar
 * detector meter. Tune on-device.
 */
export const SCORE_SMOOTHING_ALPHA = 0.5;

/** Default tuning applied by createDetectionTracker. */
export const DEFAULT_TRACKER_CONFIG: TrackerConfig = {
  iouMatchThreshold: IOU_MATCH_THRESHOLD,
  maxMisses: MAX_MISSES,
  scoreSmoothingAlpha: SCORE_SMOOTHING_ALPHA,
};
