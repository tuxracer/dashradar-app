import type { ReactNode } from "react";
import { SettingsButton } from "@/components/SettingsButton";
import { WORDMARK } from "@/lib/branding";

/** Props for StatusBar. */
type StatusBarProps = {
  /**
   * Optional element rendered horizontally centered on the bar's line,
   * vertically aligned with the wordmark and gear (the bar is a positioned
   * flex row, so the slot centers against it on both axes). Used for the
   * zoom indicator pill. A plain middle flex child would sit off-center,
   * since the wordmark and gear ends have unequal widths.
   */
  center?: ReactNode;
};

/**
 * Top bar over the radar: the DASHRADAR.APP wordmark on the left, the settings
 * gear on the right, and an optional centered slot between them. The engine
 * readout now lives in the full-screen settings panel, keeping this bar minimal
 * and glanceable for a driver.
 * pointer-events are disabled on the container so the video and HUD underneath
 * stay interactive; SettingsButton re-enables them for the gear itself.
 */
export const StatusBar = ({ center }: StatusBarProps) => {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] flex items-center justify-between px-4">
      <span className="text-[13px] font-semibold tracking-[0.34em] text-white/85">
        {WORDMARK}
      </span>
      {center && (
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          {center}
        </span>
      )}
      <SettingsButton />
    </div>
  );
};
