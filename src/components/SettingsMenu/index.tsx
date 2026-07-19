import { useEffect, useRef, useState } from "react";
import { Settings } from "lucide-react";
import { useSettings } from "@/context/SettingsContext";

/**
 * Gear button in the top bar that opens a small panel of display options. The
 * first option toggles the camera feed on and off. Reads and writes settings
 * through useSettings(), so it must be rendered inside a SettingsProvider. The
 * root sets pointer-events-auto because its container (StatusBar) disables
 * pointer events.
 */
export const SettingsMenu = () => {
  const { showVideo, toggleShowVideo } = useSettings();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const container = containerRef.current;
      if (
        container &&
        event.target instanceof Node &&
        !container.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="pointer-events-auto relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center justify-center rounded-full p-1 text-white/70 transition-colors hover:text-white/90"
      >
        <Settings className="h-5 w-5" strokeWidth={2} />
        <span className="sr-only">Open settings</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 min-w-44 rounded-lg border border-white/15 bg-surface/90 px-3 py-2 backdrop-blur">
          <button
            type="button"
            onClick={toggleShowVideo}
            className="flex w-full items-center justify-between gap-6 py-1 text-sm font-semibold tracking-[0.08em] text-white/85"
          >
            <span>Video feed</span>
            <span
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                showVideo ? "bg-hud-amber" : "bg-white/25"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-surface transition-transform ${
                  showVideo
                    ? "translate-x-[1.125rem]"
                    : "translate-x-[0.1875rem]"
                }`}
              />
            </span>
          </button>
        </div>
      )}
    </div>
  );
};
