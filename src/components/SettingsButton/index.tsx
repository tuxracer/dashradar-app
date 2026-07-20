import { track } from "@vercel/analytics";
import { Settings } from "lucide-react";
import { useSettings } from "@/context/SettingsContext";

/**
 * Gear button in the top bar. Opens the full-screen settings panel. It has a
 * large tap target so a driver can hit it from the seat with the phone on a
 * dash mount. The root sets pointer-events-auto because its container
 * (StatusBar) disables pointer events.
 */
export const SettingsButton = () => {
  const { openSettings } = useSettings();

  const handleOpen = () => {
    track("settings_open");
    openSettings();
  };

  return (
    <button
      type="button"
      onClick={handleOpen}
      className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full text-white/70 transition-colors hover:text-white/90"
    >
      <Settings className="h-7 w-7" strokeWidth={2} />
      <span className="sr-only">Open settings</span>
    </button>
  );
};
