import type { IdentifiedDetection } from "@/types";

/**
 * Per-millisecond motion of a track's box, measured between its last two
 * sightings. Per elapsed time, never per result: scans arrive anywhere from
 * one to five seconds apart, so a per-result delta would predict a different
 * physical speed at every pacing rate.
 */
export type BoxVelocity = {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
};

/** A detection tracked across frames, with anti-flicker bookkeeping. */
export type Track = IdentifiedDetection & {
  /** Result timestamp (performance.now() ms) a detection last matched this
   * track, which is what its coasting budget is measured from. */
  lastSeenAt: number;
  /** Box motion between the last two sightings; zero until seen twice. */
  velocity: BoxVelocity;
};

/** All tracks currently held. */
export type TrackerState = {
  tracks: Track[];
};

export type TrackerConfig = {
  /** Minimum IoU for a detection to match an existing track. */
  iouMatchThreshold: number;
  /** Elapsed ms since a track's last match it may coast before being dropped. */
  maxCoastMs: number;
  /**
   * Blend weight for a matched detection's score, in (0, 1]. Each match moves
   * the track's score this fraction of the way toward the new raw score, so
   * frame-to-frame model jitter averages out instead of passing through. 1
   * disables smoothing (adopt the raw score outright).
   */
  scoreSmoothingAlpha: number;
  /** Mints the id a brand-new track is born with. */
  mintId: () => string;
  /** Mints a new track's color from its just-minted id. */
  mintColor: (id: string) => string;
};
