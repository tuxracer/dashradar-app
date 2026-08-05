import type { TrackerConfig } from "./types";

/**
 * Minimum IoU for a detection to be matched to an existing track between
 * frames. Low enough to tolerate the box drift of a moving object and camera.
 * Tune on-device.
 */
export const IOU_MATCH_THRESHOLD = 0.3;

/**
 * Longest a track may coast unmatched before being dropped, so a box does not
 * flicker off when the model briefly loses it. A time budget rather than a
 * count of missed results on purpose: results arrive anywhere from every
 * second (the pacing floor) to every five (the cap on a hot device), so a
 * miss count would stretch how long a vanished vehicle keeps driving the
 * alert by exactly the pacing multiple, and it would stretch it furthest on
 * the throttled device that scans least. The value preserves the old
 * two-missed-results behavior at the floor cadence.
 */
export const MAX_COAST_MS = 2_500;

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
  maxCoastMs: MAX_COAST_MS,
  scoreSmoothingAlpha: SCORE_SMOOTHING_ALPHA,
};
