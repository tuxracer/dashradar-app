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
};
