import type { NormalizedBox } from "@/types";
import { ZOOM_2X, ZOOM_OFF } from "@/workers/detection/consts";
// centerCropRegion is one of the worker module's pure helpers (no
// onnxruntime-web import), so reusing it here keeps the fit check's geometry
// byte-identical to the crop the worker will actually take. Only index.ts is
// off-limits to consumers (it is the worker body itself).
import { centerCropRegion } from "@/workers/detection/inference";
import { AUTO_ZOOM_FIT_MARGIN } from "./consts";
import type { AutoZoomFrame, AutoZoomState } from "./types";

export * from "./consts";
export * from "./types";

/**
 * Starting state for the auto zoom: the full 1x view, nothing locked. Also
 * the state to reset to whenever a scanning session stops or the zoom mode
 * changes, so a session always begins zoomed out.
 */
export const initialAutoZoomState = (): AutoZoomState => ({
  zoom: ZOOM_OFF,
  locked: false,
});

/**
 * The 2x crop region as a normalized full-frame box, inset on every side by
 * AUTO_ZOOM_FIT_MARGIN of the region's side. A detection fitting inside this
 * box would still be fully visible, with headroom, after switching to 2x.
 */
const fitRegion = (frameWidth: number, frameHeight: number): NormalizedBox => {
  const { sx, sy, side } = centerCropRegion(frameWidth, frameHeight, ZOOM_2X);
  const inset = side * AUTO_ZOOM_FIT_MARGIN;
  return {
    xmin: (sx + inset) / frameWidth,
    ymin: (sy + inset) / frameHeight,
    xmax: (sx + side - inset) / frameWidth,
    ymax: (sy + side - inset) / frameHeight,
  };
};

/** Whether `box` lies entirely inside `region` (both full-frame normalized). */
const boxInside = (box: NormalizedBox, region: NormalizedBox): boolean => {
  return (
    box.xmin >= region.xmin &&
    box.ymin >= region.ymin &&
    box.xmax <= region.xmax &&
    box.ymax <= region.ymax
  );
};

/**
 * Decide the crop factor for the next scan from the scan that just finished.
 * Pure; the caller keeps the returned state and captures the next frame at
 * its `zoom`.
 *
 * With nothing detected the zoom alternates, flipping to the level the scan
 * was not captured at, so idle scanning covers both fields of view at no
 * extra inference cost. That flip is also the release path for a lock: losing
 * a contact at 2x zooms out first, which may bring a vehicle that outgrew the
 * narrow view back into frame.
 *
 * With detections present the zoom never moves in a way that could crop them
 * out. A 2x scan that sees something locks at 2x. A 1x scan that sees
 * something switches to 2x only when every tracked box fits inside the 2x
 * crop region inset by AUTO_ZOOM_FIT_MARGIN; otherwise it locks at 1x, since
 * zooming in would push the very thing being watched off the input.
 */
export const stepAutoZoom = (frame: AutoZoomFrame): AutoZoomState => {
  if (frame.detections.length === 0) {
    return {
      zoom: frame.zoom === ZOOM_2X ? ZOOM_OFF : ZOOM_2X,
      locked: false,
    };
  }
  if (frame.zoom === ZOOM_2X) {
    return { zoom: ZOOM_2X, locked: true };
  }
  const region = fitRegion(frame.frameWidth, frame.frameHeight);
  const allFit = frame.detections.every((detection) =>
    boxInside(detection.box, region),
  );
  return allFit
    ? { zoom: ZOOM_2X, locked: false }
    : { zoom: ZOOM_OFF, locked: true };
};
