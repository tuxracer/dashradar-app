import type { Detection, NormalizedBox } from "@/types";
import { isRawDetection } from "@/types";
import type { AutoZoomLevel } from "@/lib/autoZoom";
import type { DetectionClass } from "@/lib/detectionModels";
import { ZOOM_OFF } from "@/workers/detection/consts";
import { centerCropRegion } from "@/workers/detection/inference";
import { CONFIDENCE_THRESHOLD } from "./consts";

export * from "./consts";

export type Size = { width: number; height: number };

export type PixelBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * One frame's detections shaped for the HUD. `top` is the highest-scoring
 * detection: the dial's percentage and the class name beside it both read it.
 *
 * The contact card and its direction readout are not drawn from this model at
 * all; they come from the worker's own score-based pick (`topDetectionIndex`
 * in `src/workers/detection/inference.ts`). Both pick by score, but from
 * different data: the card from the raw detections of the frame just decoded,
 * this model from the coasted tracker set. So they name the same detection on
 * a live frame and can drift apart while a track coasts, which is the same
 * lag that lets the class name outlive the detection that produced it. Auto
 * zoom reads the whole tracked set (`stepAutoZoom({ detections: tracked,
 * ... })`), not any single detection here.
 */
export type HudModel = {
  top: Detection | undefined;
};

/**
 * Validate raw worker output and enrich each confident detection with the
 * display label its class reads as on the HUD.
 *
 * There is no allowlist. That made sense against a generic 80-class COCO model,
 * where filtering to road-relevant classes was the point, but against a
 * checkpoint trained in-house, discarding a class we deliberately trained is a
 * bug. A label the table does not name is still kept, under its own name
 * uppercased, so a detection can never disappear without a trace. The classes
 * default to none for the same reason: they arrive from the worker on `ready`,
 * and a detection decoded before they land should read plainly rather than not
 * at all.
 */
export const enrichDetections = (
  raw: unknown,
  threshold: number = CONFIDENCE_THRESHOLD,
  classes: readonly DetectionClass[] = [],
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
        score: candidate.score,
        box: candidate.box,
      },
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
