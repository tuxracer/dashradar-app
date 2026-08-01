import type { ZoomMode } from "@/context/SettingsContext";

/** GitHub repository opened from the About row. */
export const REPO_URL = "https://github.com/tuxracer/dashradar-app";

/** Confirmation prompt shown before the Reset app data row wipes the install. */
export const RESET_CONFIRM_MESSAGE = "Erase all app data and reload?";

/**
 * Segments of the Zoom row's mode picker, in display order. Labels are the
 * on-glass text; each maps to the ZoomMode it selects.
 */
export const ZOOM_MODE_OPTIONS: readonly {
  mode: ZoomMode;
  label: string;
}[] = [
  { mode: "1x", label: "1X" },
  { mode: "2x", label: "2X" },
  { mode: "auto", label: "AUTO" },
];
