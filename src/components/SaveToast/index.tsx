import { useEffect, useState } from "react";
import type { SavedFrame } from "@/context/DetectionContext";
import { SAVE_TOAST_DURATION_MS } from "./consts";

export * from "./consts";

/** Props for SaveToast. */
type SaveToastProps = {
  /**
   * Latest auto-saved frame from useDetection(). A new object per save (its
   * `at` is fresh each time), which is what re-shows the toast for a run of
   * saved detections.
   */
  saved: SavedFrame | undefined;
};

/**
 * Transient confirmation that auto save wrote a frame to disk. A browser
 * download gives no visible sign of itself on a phone, so without this a
 * collection drive cannot tell a working setup from one silently saving
 * nothing. Lives above the contact card, since it is transient and the card
 * is not, and it never takes pointer events so it cannot swallow a tap meant
 * for the card's SAVE button underneath.
 */
export const SaveToast = ({ saved }: SaveToastProps) => {
  // The save whose toast has already timed out. Visibility is derived from it
  // rather than held as its own flag, so a new save shows the toast by simply
  // not being the expired one: no state has to be set as the save arrives.
  const [expired, setExpired] = useState<SavedFrame>();

  useEffect(() => {
    if (!saved) {
      return;
    }
    const timer = window.setTimeout(
      () => setExpired(saved),
      SAVE_TOAST_DURATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [saved]);

  if (!saved) {
    return null;
  }
  const visible = saved !== expired;

  return (
    <div
      data-testid="save-toast"
      data-visible={visible}
      className={`pointer-events-none absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 z-30 max-w-[70%] rounded-lg border border-hud-amber/40 bg-black/80 px-4 py-2 backdrop-blur-sm transition-opacity duration-300 ${visible ? "opacity-100" : "opacity-0"}`}
    >
      <div className="text-[13px] font-semibold tracking-[0.28em] text-hud-amber">
        FRAME SAVED
      </div>
      <div className="truncate font-mono text-[11px] text-white/60">
        {saved.filename}
      </div>
    </div>
  );
};
