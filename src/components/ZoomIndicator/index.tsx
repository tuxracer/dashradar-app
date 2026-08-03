import type { ZoomMode } from "@/context/SettingsContext";

/** Props for ZoomIndicator. Data comes in as props (from RadarScreen, the
 * same way RadarDetectorScreen is fed) so the pill renders without the
 * worker in tests. */
type ZoomIndicatorProps = {
  /** Zoom mode from useSettings(). */
  mode: ZoomMode;
};

/**
 * Amber pill showing which zoom the detector is scanning at. Visibility is
 * the caller's job: RadarScreen renders it only while the zoom indicator
 * developer option is on, and places it in StatusBar's center slot so it sits
 * vertically aligned with the wordmark. Only the pill itself lives here.
 */
export const ZoomIndicator = ({ mode }: ZoomIndicatorProps) => {
  return (
    <span className="pointer-events-none whitespace-nowrap rounded-full border border-hud-amber/45 px-3 py-0.5 text-[13px] font-semibold tracking-[0.22em] text-hud-amber">
      {mode === "2x" ? "2X" : "1X"}
    </span>
  );
};
