import type { ReactNode } from "react";
import { SettingsButton } from "@/components/SettingsButton";
import { ViewModeButton } from "@/components/ViewModeButton";
import { WORDMARK } from "@/lib/branding";

type StatusBarProps = {
  /**
   * Optional element centered on the bar's line, used for the status pills. The
   * three-column grid is what centers it on the viewport despite the wordmark and
   * gear having unequal widths, and lets a wide slot squeeze the ends rather than
   * overlap them.
   */
  center?: ReactNode;
};

/**
 * Top bar over the radar: wordmark left, view toggle and gear right, an optional
 * centered slot between. Diagnostics belong in the debug overlay; the bar stays
 * glanceable. pointer-events are off so the HUD underneath stays interactive.
 */
export const StatusBar = ({ center }: StatusBarProps) => {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-4">
      <span className="min-w-0 truncate text-[13px] font-semibold tracking-[0.34em] text-white/85 scene-light:text-black/80">
        {WORDMARK}
      </span>
      {/* Always rendered, even empty, so the gear keeps the third column. */}
      <span className={`justify-self-center ${center ? "px-3" : ""}`}>
        {center}
      </span>
      <span className="flex items-center gap-1 justify-self-end">
        <ViewModeButton />
        <SettingsButton />
      </span>
    </div>
  );
};
