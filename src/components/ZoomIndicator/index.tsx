import type { ZoomMode } from "@/context/SettingsContext";
import type { AutoZoomLevel } from "@/lib/autoZoom";
import { ZOOM_2X } from "@/workers/detection/consts";

/** Props for ZoomIndicator. Data comes in as props (from RadarScreen, the
 * same way RadarDetectorScreen is fed) so the chip renders without the
 * worker in tests. */
type ZoomIndicatorProps = {
  /** Effective zoom mode from useSettings(), already gated on Developer options. */
  mode: ZoomMode;
  /** The auto zoom machine's current crop factor, from useDetection(). */
  level: AutoZoomLevel;
};

/**
 * Amber pill centered in the top status bar showing which zoom the detector
 * is scanning at. Renders nothing in the plain 1x mode, so a normal drive
 * (Developer options off) never shows it. The fixed 2x mode reads a constant
 * "2X"; auto reads "AUTO · 1X" / "AUTO · 2X" live as the machine alternates
 * and locks. Positioned to sit on the StatusBar's line (same top offset) but
 * rendered as its own absolutely centered element, since the bar's
 * justify-between flex row has unequal ends and would push a middle child
 * off-center.
 */
export const ZoomIndicator = ({ mode, level }: ZoomIndicatorProps) => {
  if (mode === "1x") {
    return null;
  }
  const label =
    mode === "2x" ? "2X" : level === ZOOM_2X ? "AUTO · 2X" : "AUTO · 1X";
  return (
    <span className="pointer-events-none absolute left-1/2 top-[max(0.75rem,env(safe-area-inset-top))] -translate-x-1/2 rounded-full border border-hud-amber/45 px-3 py-0.5 text-[13px] font-semibold tracking-[0.22em] text-hud-amber">
      {label}
    </span>
  );
};
