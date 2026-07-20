import { isBoolean, isPlainObject } from "remeda";

/** User-controlled display options for the HUD. Serialized to localStorage. */
export type Settings = {
  /**
   * When false, the camera feed is visually hidden and only the radar
   * backdrop plus detections are shown. Detection keeps running either way.
   */
  showVideo: boolean;
  /**
   * When true, an on-screen debug overlay renders performance and development
   * diagnostics (timing, detection counts, system info). Off by default.
   */
  showDebug: boolean;
};

/** Value exposed by the settings context via useSettings(). */
export type SettingsContextValue = {
  showVideo: boolean;
  toggleShowVideo: () => void;
  showDebug: boolean;
  toggleShowDebug: () => void;
  /** Whether the full-screen settings panel is open. Ephemeral, not persisted. */
  settingsOpen: boolean;
  /** Opens the full-screen settings panel. */
  openSettings: () => void;
  /** Closes the full-screen settings panel. */
  closeSettings: () => void;
};

/**
 * Validates a value parsed from localStorage before it is trusted as settings.
 * Each known field is optional-but-typed so a blob written by an older or newer
 * build (for example one predating showDebug) still validates; loadSettings
 * fills any missing field from DEFAULT_SETTINGS. Corrupt or wrongly-typed
 * fields fall back to defaults instead of poisoning app state.
 */
export const isPersistedSettings = (
  value: unknown,
): value is Partial<Settings> => {
  return (
    isPlainObject(value) &&
    (value.showVideo === undefined || isBoolean(value.showVideo)) &&
    (value.showDebug === undefined || isBoolean(value.showDebug))
  );
};
