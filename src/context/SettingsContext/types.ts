import { isBoolean, isPlainObject } from "remeda";

/** User-controlled display options for the HUD. Serialized to localStorage. */
export type Settings = {
  /**
   * When false, the camera feed is visually hidden and only the radar
   * backdrop plus detections are shown. Detection keeps running either way.
   */
  showVideo: boolean;
};

/** Value exposed by the settings context via useSettings(). */
export type SettingsContextValue = {
  showVideo: boolean;
  toggleShowVideo: () => void;
};

/**
 * Validates a value parsed from localStorage before it is trusted as Settings,
 * so corrupt or outdated stored JSON falls back to defaults instead of
 * poisoning app state.
 */
export const isPersistedSettings = (value: unknown): value is Settings => {
  return isPlainObject(value) && isBoolean(value.showVideo);
};
