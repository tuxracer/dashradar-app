import type { Detection } from "@/types";

/** A detection tracked across frames, with confirmation bookkeeping. */
export type Track = Detection & {
  /** Stable id for the life of the track. */
  id: number;
  /** Timestamp (ms) of the track's first sighting. */
  firstSeenMs: number;
  /**
   * True once the track was matched while at least `persistMs` old. Stays true
   * while the track coasts through unmatched frames.
   */
  confirmed: boolean;
  /** Consecutive processed frames with no matching detection. */
  misses: number;
};

/** All tracks currently held, plus the next id to assign. */
export type TrackerState = {
  tracks: Track[];
  nextId: number;
};

/** Tuning for the persistence gate. */
export type TrackerConfig = {
  /** Minimum track age (ms) before it can confirm. */
  persistMs: number;
  /** Minimum IoU for a detection to match an existing track. */
  iouMatchThreshold: number;
  /** Unmatched frames a confirmed track coasts before being dropped. */
  maxMisses: number;
};
