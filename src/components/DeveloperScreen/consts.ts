import type { ZoomMode } from "@/context/SettingsContext";

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
];

/**
 * Gap between one revealed row's entrance and the next, matching the model
 * screen's list. Flipping the master switch drops a dozen rows onto the screen
 * at once, and the stagger is what says they arrived rather than were always
 * there.
 */
export const ROW_ENTER_STAGGER_MS = 45;
