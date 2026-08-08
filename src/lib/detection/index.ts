import type { Detection, NormalizedBox } from "@/types";
import { isRawDetection } from "@/types";
import type { ZoomLevel } from "@/workers/detection/types";
import { ZOOM_OFF } from "@/workers/detection/consts";
import { centerCropRegion } from "@/workers/detection/inference";
import {
  CONFIDENCE_THRESHOLD,
  OWN_HOOD_MAX_BOTTOM_GAP,
  OWN_HOOD_MAX_HEIGHT,
  OWN_HOOD_MIN_WIDTH,
} from "./consts";

export * from "./consts";

export type Size = { width: number; height: number };

export type PixelBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * One frame's detections shaped for the HUD; `top` drives the dial. The contact
 * card picks separately, off the frame's raw detections rather than this coasted
 * set, so the two agree on a live frame and drift apart while a track coasts.
 */
export type HudModel = {
  top: Detection | undefined;
};

/**
 * Whether a box is the camera car's own hood rather than a road contact: nearly
 * the scanned region's full width, short, and pinned to the region's bottom
 * edge. A dash mount puts the hood in every frame and the model rightly calls
 * it a car, so its unmistakable shape is what tells it apart. Everything is
 * measured against `scanRegion` because that is the whole world the model saw;
 * a box cannot span more of the frame than the region lets it.
 */
export const isOwnHood = (
  box: NormalizedBox,
  scanRegion: NormalizedBox,
): boolean => {
  const regionWidth = scanRegion.xmax - scanRegion.xmin;
  const regionHeight = scanRegion.ymax - scanRegion.ymin;
  if (regionWidth <= 0 || regionHeight <= 0) {
    return false;
  }
  const relWidth = (box.xmax - box.xmin) / regionWidth;
  const relHeight = (box.ymax - box.ymin) / regionHeight;
  const bottomGap = (scanRegion.ymax - box.ymax) / regionHeight;
  return (
    relWidth >= OWN_HOOD_MIN_WIDTH &&
    relHeight <= OWN_HOOD_MAX_HEIGHT &&
    bottomGap <= OWN_HOOD_MAX_BOTTOM_GAP
  );
};

/**
 * Validate raw worker output and keep what clears the threshold. There is no
 * allowlist: every label the model emits is kept, whatever it is called. With a
 * `scanRegion`, boxes shaped like the camera car's own hood are dropped too,
 * whatever their class, so the driver's own car never drives the alert.
 */
export const enrichDetections = (
  raw: unknown,
  threshold: number = CONFIDENCE_THRESHOLD,
  scanRegion?: NormalizedBox,
): Detection[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(isRawDetection).flatMap((candidate) => {
    if (candidate.score < threshold) {
      return [];
    }
    if (scanRegion && isOwnHood(candidate.box, scanRegion)) {
      return [];
    }
    return [
      { label: candidate.label, score: candidate.score, box: candidate.box },
    ];
  });
};

/** Shape one frame's detections into what the HUD renders. */
export const buildHudModel = (detections: Detection[]): HudModel => {
  const top = detections.reduce<Detection | undefined>(
    (best, candidate) =>
      best === undefined || candidate.score > best.score ? candidate : best,
    undefined,
  );
  return { top };
};

/** Scale factor for a video rendered `object-fit: contain` in the viewport. */
export const containScale = (video: Size, viewport: Size): number =>
  Math.min(viewport.width / video.width, viewport.height / video.height);

/**
 * Map a normalized box onto the viewport for a video rendered `object-fit:
 * contain`. Fitting rather than cropping is what lets the detection view show
 * every box: under cover, one near the frame edge lands in the cropped margin.
 */
export const mapBoxToViewport = (
  box: NormalizedBox,
  video: Size,
  viewport: Size,
): PixelBox => {
  const scale = containScale(video, viewport);
  const displayedWidth = video.width * scale;
  const displayedHeight = video.height * scale;
  const offsetX = (viewport.width - displayedWidth) / 2;
  const offsetY = (viewport.height - displayedHeight) / 2;
  return {
    left: offsetX + box.xmin * displayedWidth,
    top: offsetY + box.ymin * displayedHeight,
    width: (box.xmax - box.xmin) * displayedWidth,
    height: (box.ymax - box.ymin) * displayedHeight,
  };
};

/**
 * The region of a frame the model is actually shown, as a full-frame normalized
 * box. The detection view outlines it so a vehicle outside the crop reads as
 * never scanned rather than as a miss. Built on the worker's own
 * centerCropRegion, so the outline cannot drift from the crop.
 */
export const scanRegionBox = (
  frame: Size,
  zoom: ZoomLevel = ZOOM_OFF,
): NormalizedBox => {
  const { sx, sy, side } = centerCropRegion(frame.width, frame.height, zoom);
  return {
    xmin: sx / frame.width,
    ymin: sy / frame.height,
    xmax: (sx + side) / frame.width,
    ymax: (sy + side) / frame.height,
  };
};
