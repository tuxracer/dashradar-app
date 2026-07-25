import type { ZoomMode } from "@/context/SettingsContext";
import type { AutoZoomLevel } from "@/lib/autoZoom";
import { ZOOM_2X } from "@/workers/detection/consts";

/** Props for ZoomIndicator. Data comes in as props (from RadarScreen, the
 * same way RadarDetectorScreen is fed) so the pill renders without the
 * worker in tests. */
type ZoomIndicatorProps = {
  /** Zoom mode from useSettings(). */
  mode: ZoomMode;
  /** The auto zoom machine's current crop factor, from useDetection(). */
  level: AutoZoomLevel;
  /** Whether the auto zoom machine is holding its level on a detection. */
  locked: boolean;
};

/**
 * Amber pill showing which zoom the detector is scanning at: a constant 1X
 * or 2X in the fixed modes, and the live level in auto mode with a LOCKED
 * suffix while a detection is holding it there. Visibility is the caller's
 * job: RadarScreen renders it only while the zoom indicator developer option
 * is on, and places it in StatusBar's center slot so it sits vertically
 * aligned with the wordmark. Only the pill itself lives here.
 */
export const ZoomIndicator = ({ mode, level, locked }: ZoomIndicatorProps) => {
  const label =
    mode === "1x"
      ? "1X"
      : mode === "2x"
        ? "2X"
        : `AUTO · ${level === ZOOM_2X ? "2X" : "1X"}${locked ? " · LOCKED" : ""}`;
  return (
    <span className="pointer-events-none whitespace-nowrap rounded-full border border-hud-amber/45 px-3 py-0.5 text-[13px] font-semibold tracking-[0.22em] text-hud-amber">
      {label}
    </span>
  );
};
