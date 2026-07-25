import type { Detection } from "@/types";
import type { ZOOM_2X, ZOOM_OFF } from "@/workers/detection/consts";

/**
 * Crop factor the auto zoom can select: the full centered square (ZOOM_OFF)
 * or the half-side 2x crop (ZOOM_2X). The same values the worker's detect
 * request takes as `zoom`.
 */
export type AutoZoomLevel = typeof ZOOM_OFF | typeof ZOOM_2X;

/**
 * Auto zoom machine state: the crop factor the next scan should be captured
 * at, and whether a present detection is holding it there. `locked` is
 * diagnostic (shown by the debug overlay); the stepper itself only needs
 * each scan's own capture zoom.
 */
export type AutoZoomState = {
  zoom: AutoZoomLevel;
  locked: boolean;
};

/** One completed scan as the auto zoom stepper sees it. */
export type AutoZoomFrame = {
  /** Crop factor the scan was captured with. */
  zoom: AutoZoomLevel;
  /**
   * The scan's coasted (tracked) detections in full-frame normalized
   * coordinates. Using the tracker output rather than the raw per-frame
   * detections means a one-frame flicker cannot unlock the zoom: an object
   * only counts as gone once the tracker drops it.
   */
  detections: Detection[];
  /** Full frame width in pixels, for the 2x-region fit check. */
  frameWidth: number;
  /** Full frame height in pixels, for the 2x-region fit check. */
  frameHeight: number;
};
