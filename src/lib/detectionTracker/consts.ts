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

/** Default tuning applied by createDetectionTracker. */
export const DEFAULT_TRACKER_CONFIG: TrackerConfig = {
  iouMatchThreshold: IOU_MATCH_THRESHOLD,
  maxMisses: MAX_MISSES,
};
