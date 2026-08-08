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
  /** Minimum pair score (see `pairScore`) for a detection to match a track. */
  iouMatchThreshold: number;
  /**
   * Score a detection earns sitting exactly on a track's predicted center
   * with no overlap evidence, in (0, 1]. Kept below 1 so real overlap always
   * outranks bare nearness; kept above the match threshold so nearness alone
   * can carry a match once displacement has killed the overlap.
   */
  proximityScoreCeiling: number;
  /**
   * Center distance at which nearness stops scoring, in average box
   * diagonals. Size-relative on purpose: a one-box-width miss is a rounding
   * error on a close vehicle and a different object on a distant one.
   */
  proximityRadiusDiagonals: number;
  /** What the match threshold relaxes to for a track unseen the longest. */
  matchGateFloor: number;
  /** Unseen-for duration at or under which the full threshold applies. */
  matchGateTightMs: number;
  /** Unseen-for duration at which the relaxing gate reaches its floor. */
  matchGateLooseMs: number;
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
