import { isBoolean, isPlainObject } from "remeda";

/** User-controlled display options for the HUD. Serialized to localStorage. */
export type Settings = {
  /**
   * When true, an on-screen debug overlay renders performance and development
   * diagnostics (timing, detection counts, system info). Off by default.
   */
  showDebug: boolean;
  /**
   * When true, radar detector mode beeps as a police vehicle is detected:
   * the beeps pulse faster (and higher-pitched) the stronger the signal, and
   * stop entirely when nothing is detected. On by default.
   */
  radarAudio: boolean;
  /**
   * When false, the detection pump runs inference flat-out with no pacing
   * floor. Takes effect only while showDebug is on (DetectionContext gates it),
   * so a phone can never run unthrottled without the debug overlay visible. On
   * by default: the 2s pacing floor is the app's thermal/battery safeguard.
   */
  throttleInference: boolean;
  /**
   * When true (the default), the worker feeds the model the largest centered
   * square crop of the camera frame, matching the Fill-with-center-crop
   * preprocessing the model trains with. When false, the frame is squished
   * onto the square input instead, a comparison mode for models trained on
   * stretched data. Squish takes effect only while showDebug is on
   * (DetectionContext gates it), so normal use always runs the default
   * center-crop path even if a stale false was left persisted.
   */
  centerCropFrames: boolean;
};

/** Value exposed by the settings context via useSettings(). */
export type SettingsContextValue = {
  showDebug: boolean;
  toggleShowDebug: () => void;
  radarAudio: boolean;
  toggleRadarAudio: () => void;
  throttleInference: boolean;
  toggleThrottleInference: () => void;
  centerCropFrames: boolean;
  toggleCenterCropFrames: () => void;
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
    (value.showDebug === undefined || isBoolean(value.showDebug)) &&
    (value.radarAudio === undefined || isBoolean(value.radarAudio)) &&
    (value.throttleInference === undefined ||
      isBoolean(value.throttleInference)) &&
    (value.centerCropFrames === undefined || isBoolean(value.centerCropFrames))
  );
};
