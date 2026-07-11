import type { Detection, NormalizedBox } from "@/types";
import { isRawDetection } from "@/types";
import {
  CONFIDENCE_THRESHOLD,
  NEAR_AREA_FRACTION,
  ROAD_CLASSES,
} from "./consts";

export * from "./consts";

export type Size = { width: number; height: number };

export type PixelBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type Blip = { x: number; near: boolean };

export type HudModel = {
  nearest: Detection | undefined;
  near: boolean;
  others: Detection[];
  blips: Blip[];
};

const boxArea = (box: NormalizedBox): number => {
  return Math.max(0, box.xmax - box.xmin) * Math.max(0, box.ymax - box.ymin);
};

const boxCenterX = (box: NormalizedBox): number => {
  return (box.xmin + box.xmax) / 2;
};

/** Validate raw worker output and keep road-relevant, confident detections. */
export const toRoadDetections = (raw: unknown): Detection[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(isRawDetection).flatMap((candidate) => {
    const roadClass = ROAD_CLASSES[candidate.label];
    if (!roadClass || candidate.score < CONFIDENCE_THRESHOLD) {
      return [];
    }
    return [
      {
        label: candidate.label,
        displayLabel: roadClass.displayLabel,
        category: roadClass.category,
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
  const blips = detections.map((candidate) => ({
    x: boxCenterX(candidate.box),
    near: near && candidate === nearest,
  }));
  return { nearest, near, others, blips };
};

/**
 * Map a normalized box onto the viewport for a video rendered with
 * `object-fit: cover` (the video is scaled up and center-cropped).
 */
export const mapBoxToViewport = (
  box: NormalizedBox,
  video: Size,
  viewport: Size,
): PixelBox => {
  const scale = Math.max(
    viewport.width / video.width,
    viewport.height / video.height,
  );
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
