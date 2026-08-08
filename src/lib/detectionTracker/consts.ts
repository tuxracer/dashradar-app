import randomColor from "randomcolor";
import type { TrackerConfig } from "./types";

/**
 * Minimum pair score for a detection to be matched to an existing track
 * between frames. Low enough to tolerate the box drift of a moving object and
 * camera. Tune on-device.
 */
export const IOU_MATCH_THRESHOLD = 0.3;

/**
 * Score of a dead-center, zero-overlap detection against a track's predicted
 * box. Tune on-device.
 */
export const PROXIMITY_SCORE_CEILING = 0.6;

/**
 * How far from a predicted center nearness keeps scoring, in average box
 * diagonals. Two diagonals lets a just-disjoint box pass the match threshold
 * while a miss beyond a couple of box widths scores nothing. Tune on-device.
 */
export const PROXIMITY_RADIUS_DIAGONALS = 2;

/**
 * Longest a track may coast unmatched, so a box does not flicker off when the
 * model briefly loses it. A time budget rather than a miss count: results arrive
 * anywhere from every second to every five, so a count would keep a vanished
 * vehicle driving the alert longest on the device that scans least.
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
  proximityScoreCeiling: PROXIMITY_SCORE_CEILING,
  proximityRadiusDiagonals: PROXIMITY_RADIUS_DIAGONALS,
  maxCoastMs: MAX_COAST_MS,
  scoreSmoothingAlpha: SCORE_SMOOTHING_ALPHA,
  mintId: () => crypto.randomUUID(),
  // Seeded with the id, so an object's color is a function of its identity
  // rather than a second piece of state.
  mintColor: (id) => randomColor({ seed: id }),
};
