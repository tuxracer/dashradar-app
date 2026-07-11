import type { HudModel, Size } from "@/lib/detection";
import { mapBoxToViewport } from "@/lib/detection";
import { TAG_OFFSET_PX } from "./consts";

export * from "./consts";

type HudOverlayProps = {
  hud: HudModel;
  videoSize: Size;
  viewportSize: Size;
};

// `mapBoxToViewport` computes pixel offsets from normalized fractions, which
// accumulates floating-point error (e.g. 0.6 - 0.4 !== 0.2 exactly). Round
// before handing values to inline styles so CSS pixel offsets land exactly.
const roundPx = (value: number): number => Math.round(value);

export const HudOverlay = ({
  hud,
  videoSize,
  viewportSize,
}: HudOverlayProps) => {
  const nearestBox = hud.nearest
    ? mapBoxToViewport(hud.nearest.box, videoSize, viewportSize)
    : undefined;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
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
          </div>
        );
      })}
    </div>
  );
};
