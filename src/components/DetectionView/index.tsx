import type { AutoZoomLevel } from "@/lib/autoZoom";
import type { Size } from "@/lib/detection";
import {
  mapBoxToViewport,
  scanRegionBox,
  CATEGORY_COLORS,
} from "@/lib/detection";
import type { Detection } from "@/types";

/** Props for DetectionView. */
type DetectionViewProps = {
  /**
   * The scan's raw per-frame detections, in full-frame normalized
   * coordinates. Boxes vanish on the first scan that stops seeing them: this
   * shows the model's own output, not the coasted tracks the meter reads.
   */
  detections: Detection[];
  /** Intrinsic size of the frame the detections were computed on. */
  frame: Size;
  /** Current viewport size, which the feed fills with object-fit: cover. */
  viewport: Size;
  /** Crop factor the frame was captured at, which sizes the region outline. */
  zoom: AutoZoomLevel;
};

/**
 * Developer-only overlay drawing the model's bounding boxes over the live
 * feed, for checking aim, framing, and false positives against what the
 * detector actually sees rather than against the meter's summary of it. Boxes
 * lag the video by up to a scan: they are drawn where the model saw them, on
 * footage that has moved on since, and there is no interpolation because a
 * box's real position is the only honest thing to show. Boxes are colored by
 * category, so several classes on screen at once stay apart at a glance. The
 * faint outline is
 * the region the model is shown at all (the centered square crop, narrowed by
 * the zoom); without it, a vehicle the crop never covered looks like a miss.
 * Geometry goes through mapBoxToViewport, so the feed underneath must be
 * rendered object-fit: cover, which is what App does in this mode.
 * pointer-events are off so the settings button underneath stays reachable.
 */
export const DetectionView = ({
  detections,
  frame,
  viewport,
  zoom,
}: DetectionViewProps) => {
  const region = mapBoxToViewport(scanRegionBox(frame, zoom), frame, viewport);
  return (
    <div
      data-testid="detection-view"
      className="pointer-events-none absolute inset-0"
    >
      <div
        data-testid="scan-region"
        className="absolute border border-dashed border-white/30"
        style={{
          left: Math.round(region.left),
          top: Math.round(region.top),
          width: Math.round(region.width),
          height: Math.round(region.height),
        }}
      />
      {detections.map((detection, index) => {
        const drawn = mapBoxToViewport(detection.box, frame, viewport);
        const color = CATEGORY_COLORS[detection.category];
        return (
          <div
            // The list is rebuilt whole on every scan and holds no state, so
            // the index is a stable key here. A key built from the label and
            // the box collides when two boxes of one class both clamp to a
            // frame edge.
            key={index}
            data-testid="detection-box"
            className="absolute border-2"
            style={{
              left: Math.round(drawn.left),
              top: Math.round(drawn.top),
              width: Math.round(drawn.width),
              height: Math.round(drawn.height),
              borderColor: color,
            }}
          >
            <span
              className="absolute left-0 top-full whitespace-nowrap bg-surface/80 px-1 text-sm font-semibold tracking-[0.08em]"
              style={{ color }}
            >
              {detection.displayLabel} {Math.round(detection.score * 100)}%
            </span>
          </div>
        );
      })}
    </div>
  );
};
