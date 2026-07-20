import { useEffect, useRef } from "react";
import { mapBoxToViewport } from "@/lib/detection";
import type { HudModel, Size } from "@/lib/detection";
import { orientationDeltaToPixels } from "@/lib/motionSensor";
import type { YawPitch } from "@/lib/motionSensor";
import type { Detection, NormalizedBox } from "@/types";
import { TAG_OFFSET_PX } from "./consts";

export * from "./consts";

type HudOverlayProps = {
  hud: HudModel;
  videoSize: Size;
  viewportSize: Size;
  /** Live yaw/pitch delta since the displayed detection was captured. */
  getMotionDelta: () => YawPitch;
  /**
   * When true, the motion delta is applied as a screen-space offset so boxes
   * track their objects between results. When false, the overlay stays fixed to
   * the screen (the offset is held at zero).
   */
  stabilize: boolean;
  /** When true, annotate each detection with its confidence and box coords. */
  debug?: boolean;
};

// `mapBoxToViewport` computes pixel offsets from normalized fractions, which
// accumulates floating-point error (e.g. 0.6 - 0.4 !== 0.2 exactly). Round
// before handing values to inline styles so CSS pixel offsets land exactly.
const roundPx = (value: number): number => Math.round(value);

/** Confidence as a whole-number percentage, e.g. 0.92 -> "92%". */
const formatConfidence = (score: number): string =>
  `${Math.round(score * 100)}%`;

/** Normalized box as "xmin,ymin xmax,ymax", each to two decimals. */
const formatBox = (box: NormalizedBox): string =>
  `${box.xmin.toFixed(2)},${box.ymin.toFixed(2)} ${box.xmax.toFixed(2)},${box.ymax.toFixed(2)}`;

/** Confidence and normalized box coords for a detection, shown as the debug annotation. */
const debugAnnotation = (detection: Detection) => (
  <span className="mt-0.5 flex items-center justify-center gap-1 whitespace-nowrap rounded bg-black/70 px-1.5 py-px text-center font-mono text-[10px] leading-tight tracking-tight text-hud-amber">
    <span>{formatConfidence(detection.score)}</span>
    <span>·</span>
    <span>{formatBox(detection.box)}</span>
  </span>
);

export const HudOverlay = ({
  hud,
  videoSize,
  viewportSize,
  getMotionDelta,
  stabilize,
  debug,
}: HudOverlayProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoSizeRef = useRef(videoSize);
  const viewportSizeRef = useRef(viewportSize);
  const getMotionDeltaRef = useRef(getMotionDelta);
  const stabilizeRef = useRef(stabilize);

  // Refs may not be written during render (react-hooks/refs), so the latest
  // props are copied in via an effect instead, mirroring the sendFrameRef
  // pattern in DetectionContext. The persistent rAF loop below reads these
  // refs so it always sees the latest values without re-subscribing.
  useEffect(() => {
    videoSizeRef.current = videoSize;
    viewportSizeRef.current = viewportSize;
    getMotionDeltaRef.current = getMotionDelta;
    stabilizeRef.current = stabilize;
  }, [videoSize, viewportSize, getMotionDelta, stabilize]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const container = containerRef.current;
      if (container) {
        // With stabilization off, hold the overlay at zero rather than applying
        // the motion offset.
        const { dx, dy } = stabilizeRef.current
          ? orientationDeltaToPixels(
              getMotionDeltaRef.current(),
              videoSizeRef.current,
              viewportSizeRef.current,
            )
          : { dx: 0, dy: 0 };
        container.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const nearestBox = hud.nearest
    ? mapBoxToViewport(hud.nearest.box, videoSize, viewportSize)
    : undefined;

  return (
    <div
      ref={containerRef}
      data-testid="hud-overlay"
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ transform: "translate(0px, 0px)" }}
    >
      {hud.nearest && nearestBox && (
        <div
          data-testid="nearest-box"
          className={
            hud.near
              ? "absolute rounded-[10px] border-2 border-hud-amber shadow-[0_0_18px_-6px_var(--color-hud-amber)]"
              : "absolute rounded-[10px] border-2 border-white/85"
          }
          style={{
            left: roundPx(nearestBox.left),
            top: roundPx(nearestBox.top),
            width: roundPx(nearestBox.width),
            height: roundPx(nearestBox.height),
          }}
        >
          <span
            className={
              hud.near
                ? "absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-hud-amber px-3 py-px text-xs font-semibold tracking-[0.14em] text-black"
                : "absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/30 bg-black/65 px-3 py-px text-xs font-semibold tracking-[0.14em] text-white/90"
            }
          >
            {hud.nearest.displayLabel}
            {hud.near ? " · NEAR" : ""}
          </span>
          {debug && (
            <span className="absolute -bottom-6 left-1/2 -translate-x-1/2">
              {debugAnnotation(hud.nearest)}
            </span>
          )}
        </div>
      )}
      {hud.others.map((detection, index) => {
        const box = mapBoxToViewport(detection.box, videoSize, viewportSize);
        return (
          <div
            key={`${detection.label}-${index}`}
            className="absolute -translate-x-1/2 text-center"
            style={{
              left: roundPx(box.left + box.width / 2),
              top: roundPx(Math.max(box.top - TAG_OFFSET_PX, 0)),
            }}
          >
            <span className="rounded-full border border-white/30 bg-black/65 px-2.5 py-px text-[11px] font-semibold tracking-[0.16em] text-white/90">
              {detection.displayLabel}
            </span>
            <span className="mx-auto mt-0.5 block h-5 w-px bg-gradient-to-b from-white/75 to-transparent" />
            {debug && debugAnnotation(detection)}
          </div>
        );
      })}
    </div>
  );
};
