import type { Detection, NormalizedBox } from "@/types";
import { isRawDetection } from "@/types";
import type { AutoZoomLevel } from "@/lib/autoZoom";
import type { DetectionClass } from "@/workers/detection/consts";
import { MODEL_CLASSES, ZOOM_OFF } from "@/workers/detection/consts";
import { centerCropRegion } from "@/workers/detection/inference";
import { CONFIDENCE_THRESHOLD, NEAR_AREA_FRACTION } from "./consts";

export * from "./consts";

export type Size = { width: number; height: number };

export type PixelBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type HudModel = {
  nearest: Detection | undefined;
  near: boolean;
  others: Detection[];
};

const boxArea = (box: NormalizedBox): number => {
  return Math.max(0, box.xmax - box.xmin) * Math.max(0, box.ymax - box.ymin);
};

/**
 * Validate raw worker output and enrich each confident detection with its
 * class's display label and category.
 *
 * There is no allowlist. That made sense against a generic 80-class COCO model,
 * where filtering to road-relevant classes was the point, but against a
 * checkpoint trained in-house, discarding a class we deliberately trained is a
 * bug. A label the table does not name is still kept, under the `unknown`
 * category and its own name uppercased, so a detection can never disappear
 * without a trace. That case needs the worker and the HUD to have diverged on a
 * table they both read, so it should be unreachable.
 */
export const toRoadDetections = (
  raw: unknown,
  threshold: number = CONFIDENCE_THRESHOLD,
  classes: readonly DetectionClass[] = MODEL_CLASSES,
): Detection[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(isRawDetection).flatMap((candidate) => {
    if (candidate.score < threshold) {
      return [];
    }
    const known = classes.find((entry) => entry.label === candidate.label);
    return [
      {
        label: candidate.label,
        displayLabel: known?.displayLabel ?? candidate.label.toUpperCase(),
        category: known?.category ?? "unknown",
        score: candidate.score,
        box: candidate.box,
      },
    ];
  });
};

/** Shape one frame's detections into what the HUD renders. */
export const buildHudModel = (detections: Detection[]): HudModel => {
  const nearest = detections.reduce<Detection | undefined>(
    (best, candidate) =>
      best === undefined || boxArea(candidate.box) > boxArea(best.box)
        ? candidate
        : best,
    undefined,
  );
  const near =
    nearest !== undefined && boxArea(nearest.box) >= NEAR_AREA_FRACTION;
  const others = detections.filter((candidate) => candidate !== nearest);
  return { nearest, near, others };
};

/** Scale factor for a video rendered `object-fit: cover` in the viewport. */
export const coverScale = (video: Size, viewport: Size): number =>
  Math.max(viewport.width / video.width, viewport.height / video.height);

/**
 * Map a normalized box onto the viewport for a video rendered with
 * `object-fit: cover` (the video is scaled up and center-cropped).
 */
export const mapBoxToViewport = (
  box: NormalizedBox,
  video: Size,
  viewport: Size,
): PixelBox => {
  const scale = coverScale(video, viewport);
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
 * The region of a frame the model is actually shown, as a full-frame
 * normalized box: the centered square crop the worker takes, narrowed by the
 * capture zoom. The detection view outlines it so a vehicle outside the crop
 * reads as never having been scanned rather than as a miss. Built on the
 * worker's own centerCropRegion, so the outline cannot drift from the crop it
 * describes.
 */
export const scanRegionBox = (
  frame: Size,
  zoom: AutoZoomLevel = ZOOM_OFF,
): NormalizedBox => {
  const { sx, sy, side } = centerCropRegion(frame.width, frame.height, zoom);
  return {
    xmin: sx / frame.width,
    ymin: sy / frame.height,
    xmax: (sx + side) / frame.width,
    ymax: (sy + side) / frame.height,
  };
};
