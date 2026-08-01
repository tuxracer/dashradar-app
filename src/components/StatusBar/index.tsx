import type { ReactNode } from "react";
import { SettingsButton } from "@/components/SettingsButton";
import { WORDMARK } from "@/lib/branding";

/** Props for StatusBar. */
type StatusBarProps = {
  /**
   * Optional element rendered horizontally centered on the bar's line,
   * vertically aligned with the wordmark and gear. Used for the zoom and
   * round-trip pills. The bar is a three-column grid with equal flexible ends,
   * so this middle column sits centered on the viewport even though the
   * wordmark and gear have unequal widths, and a wide slot squeezes the ends
   * rather than overlapping them (the wordmark truncates). A plain middle flex
   * child would sit off-center; absolute centering would let the pills collide
   * with the wordmark on a narrow portrait screen.
   */
  center?: ReactNode;
};

/**
 * Top bar over the radar: the DASHRADAR.APP wordmark on the left, the settings
 * gear on the right, and an optional centered slot between them. Diagnostics
 * belong in the debug overlay, not here: the bar stays minimal and glanceable
 * for a driver.
 * pointer-events are disabled on the container so the video and HUD underneath
 * stay interactive; SettingsButton re-enables them for the gear itself.
 */
export const StatusBar = ({ center }: StatusBarProps) => {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-4">
      <span className="min-w-0 truncate text-[13px] font-semibold tracking-[0.34em] text-white/85">
        {WORDMARK}
      </span>
      {/* Always rendered, even empty, so the gear keeps the third column. */}
      <span className={`justify-self-center ${center ? "px-3" : ""}`}>
        {center}
      </span>
      <span className="justify-self-end">
        <SettingsButton />
      </span>
    </div>
  );
};
