import { track } from "@vercel/analytics";
import { Radar, Rotate3d } from "lucide-react";
import { useSettings } from "@/context/SettingsContext";

/**
 * View toggle in the top bar, next to the settings gear: flips the main view
 * between the radar dial and the 3D scene, showing the view a tap would
 * switch to. Same large tap target as the gear, for the same dash-mount
 * reach. Hidden while the detection-view developer option is on, because that
 * option overrides both main views and a toggle with no visible effect reads
 * as broken. The root sets pointer-events-auto because its container
 * (StatusBar) disables pointer events.
 */
export const ViewModeButton = () => {
  const { viewMode, setViewMode, detectionView } = useSettings();

  if (detectionView) {
    return null;
  }

  const next = viewMode === "radar" ? "scene" : "radar";

  const handleToggle = () => {
    track("view_mode", { mode: next });
    setViewMode(next);
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full text-white/70 transition-colors hover:text-white/90"
    >
      {next === "scene" ? (
        <Rotate3d className="h-7 w-7" strokeWidth={2} />
      ) : (
        <Radar className="h-7 w-7" strokeWidth={2} />
      )}
      <span className="sr-only">
        {next === "scene" ? "Switch to scene view" : "Switch to radar view"}
      </span>
    </button>
  );
};
