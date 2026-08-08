import type { ZoomLevel } from "@/workers/detection/types";
import type { Size } from "@/lib/detection";
import { mapBoxToViewport, scanRegionBox } from "@/lib/detection";
import type { IdentifiedDetection } from "@/types";

type DetectionViewProps = {
  /**
   * The scan's raw per-frame detections, in full-frame normalized
   * coordinates. Boxes vanish on the first scan that stops seeing them: this
   * shows the model's own output, not the coasted tracks the meter reads.
   */
  detections: IdentifiedDetection[];
  /** Intrinsic size of the frame the detections were computed on. */
  frame: Size;
  /** Current viewport size, which the feed fits into with object-fit: contain. */
  viewport: Size;
  /** Crop factor the frame was captured at, which sizes the region outline. */
  zoom: ZoomLevel;
};

/**
 * Developer-only overlay drawing the model's boxes over the live feed. Boxes lag
 * by up to a scan and are not interpolated, since a box's real position is the
 * only honest thing to show. The faint outline is the region the model is shown
 * at all; without it a vehicle the crop never covered looks like a miss.
 * Geometry goes through mapBoxToViewport, so the feed has to be object-fit:
 * contain.
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
      {detections.map((detection) => {
        const drawn = mapBoxToViewport(detection.box, frame, viewport);
        return (
          <div
            // The object's identity, so a box that persists across scans keeps
            // its DOM node even as the list reorders around it.
            key={detection.id}
            data-testid="detection-box"
            className="absolute border-2"
            style={{
              left: Math.round(drawn.left),
              top: Math.round(drawn.top),
              width: Math.round(drawn.width),
              height: Math.round(drawn.height),
              borderColor: detection.color,
            }}
          >
            <span
              className="absolute left-0 top-full whitespace-nowrap bg-surface/80 px-1 text-sm font-semibold uppercase tracking-[0.08em]"
              style={{ color: detection.color }}
            >
              {detection.rawLabel
                ? `${detection.label} (${detection.rawLabel})`
                : detection.label}{" "}
              {Math.round(detection.score * 100)}%
            </span>
          </div>
        );
      })}
    </div>
  );
};
