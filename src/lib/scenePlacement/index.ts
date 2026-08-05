import { clamp, isDefined } from "remeda";
import type { Size } from "@/lib/detection";
import type { Track } from "@/lib/detectionTracker";
import { HEIGHT_PRIORS, MAX_PLACEMENT_M, MIN_PLACEMENT_M } from "./consts";
import type { HeightPrior, PlacedKind, ScenePlacement } from "./types";

export * from "./consts";
export * from "./types";

/** Degrees to radians. */
const deg2rad = (deg: number): number => (deg * Math.PI) / 180;

/** First height prior any of whose terms appears in the lowercased label. */
const matchHeightPrior = (label: string): HeightPrior | undefined => {
  const lowered = label.toLowerCase();
  return HEIGHT_PRIORS.find((prior) =>
    prior.terms.some((term) => lowered.includes(term)),
  );
};

/**
 * Kind for a detection label, or undefined when no prior matches. A strict
 * allowlist with no fallback on purpose: a label the priors do not know has
 * no height to range it with, so it is dropped rather than placed wrongly.
 */
export const matchPlacedKind = (label: string): PlacedKind | undefined =>
  matchHeightPrior(label)?.kind;

/**
 * Pinhole focal length in pixels for a camera whose full frame spans
 * `fovDeg` degrees horizontally. Zoom independent: boxes are normalized to
 * the full frame and `frameWidthPx` is the native video width, so both
 * inputs describe the same full-frame geometry at any zoom.
 */
export const focalLengthPx = (fovDeg: number, frameWidthPx: number): number =>
  frameWidthPx / 2 / Math.tan(deg2rad(fovDeg) / 2);

/**
 * Places one track on the ground plane in ego-relative meters. The
 * similar-triangles ratio `fPx * heightM / hPx` is axial depth (`zM`, meters
 * ahead along the camera axis), not slant range: a pinhole camera scales an
 * object's image by its depth alone, wherever it sits in the frame. Lateral
 * offset then follows as `xM = zM * cxPx / fPx`, and `rangeM` exists for
 * readouts only. Never compute a slant range first and decompose it by
 * bearing; that double-counts the cosine and pulls off-axis objects too
 * close. Returns undefined when the label matches no prior, the box has no
 * height, or any box or frame value is not finite.
 */
export const placeTrack = (
  track: Track,
  frame: Size,
  fPx: number,
): ScenePlacement | undefined => {
  const prior = matchHeightPrior(track.label);
  if (!prior) {
    return undefined;
  }
  const { box } = track;
  const inputs = [
    box.xmin,
    box.ymin,
    box.xmax,
    box.ymax,
    frame.width,
    frame.height,
  ];
  if (!inputs.every((value) => Number.isFinite(value))) {
    return undefined;
  }
  const hPx = (box.ymax - box.ymin) * frame.height;
  if (hPx <= 0) {
    return undefined;
  }
  const zM = clamp((fPx * prior.heightM) / hPx, {
    min: MIN_PLACEMENT_M,
    max: MAX_PLACEMENT_M,
  });
  const cxPx = ((box.xmin + box.xmax) / 2 - 0.5) * frame.width;
  const xM = (zM * cxPx) / fPx;
  return {
    id: track.id,
    kind: prior.kind,
    label: track.label,
    score: track.score,
    xM,
    zM,
    elevationM: prior.elevationM,
    rangeM: Math.hypot(xM, zM),
    bearingRad: Math.atan2(cxPx, fPx),
  };
};

/**
 * Places every track that resolves to a height prior, dropping the rest.
 * Derives the focal length once from the field of view and the frame width.
 */
export const placeTracks = ({
  tracks,
  frame,
  fovDeg,
}: {
  tracks: readonly Track[];
  frame: Size;
  fovDeg: number;
}): ScenePlacement[] => {
  const fPx = focalLengthPx(fovDeg, frame.width);
  return tracks.map((track) => placeTrack(track, frame, fPx)).filter(isDefined);
};
