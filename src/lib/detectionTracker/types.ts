import type { Detection } from "@/types";

/** A detection tracked across frames, with anti-flicker bookkeeping. */
export type Track = Detection & {
  /** Stable id for the life of the track. */
  id: number;
  /** Consecutive processed frames with no matching detection. */
  misses: number;
};

/** All tracks currently held, plus the next id to assign. */
export type TrackerState = {
  tracks: Track[];
  nextId: number;
};

/** Tuning for the coasting tracker. */
export type TrackerConfig = {
  /** Minimum IoU for a detection to match an existing track. */
  iouMatchThreshold: number;
  /** Unmatched frames a track coasts before being dropped. */
  maxMisses: number;
  /**
   * Blend weight for a matched detection's score, in (0, 1]. Each match moves
   * the track's score this fraction of the way toward the new raw score, so
   * frame-to-frame model jitter averages out instead of passing through. 1
   * disables smoothing (adopt the raw score outright).
   */
  scoreSmoothingAlpha: number;
};
