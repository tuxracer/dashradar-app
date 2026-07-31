/** localStorage key holding the intro version the user last dismissed. */
export const INTRO_SEEN_STORAGE_KEY = "introSeen";

/**
 * Version of the intro currently shipping. Bump it whenever the intro changes
 * enough to be worth showing again: a stored value below this (or a missing or
 * non-numeric one, which is what every pre-versioning "true" reads as) shows
 * the intro to returning users once more.
 */
export const INTRO_VERSION = 2;

/** Shown in the confirm dialog before dismissing the intro on a desktop. */
export const DESKTOP_CONTINUE_CONFIRM_MESSAGE =
  "dashradar is intended to run on a phone mounted on a car dash. Are you sure you want to continue on this device?";
