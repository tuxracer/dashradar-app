import { isBoolean, isPlainObject } from "remeda";

/** User-controlled display options for the HUD. Serialized to localStorage. */
export type Settings = {
  /**
   * Master switch for the development-only settings (showDebug,
   * throttleInference, centerCropFrames). Off by default. While it is off,
   * SettingsProvider reports each of those three at its DEVELOPER_OPTIONS_OFF
   * value no matter what is stored, so a development tweak left enabled cannot
   * alter a normal drive. Their stored values survive, so turning this back on
   * restores the tweaks rather than resetting them.
   */
  developerOptions: boolean;
  /**
   * When true, an on-screen debug overlay renders performance and development
   * diagnostics (timing, detection counts, system info). A developer option, so
   * it only takes effect while developerOptions is on, and on by default there:
   * turning developer options on is itself the request to see the diagnostics.
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
   * floor. A developer option, so it only takes effect while developerOptions
   * is on and a phone can never run unthrottled otherwise. On by default: the
   * 2s pacing floor is the app's thermal/battery safeguard.
   */
  throttleInference: boolean;
  /**
   * When true (the default), the worker feeds the model the largest centered
   * square crop of the camera frame, matching the Fill-with-center-crop
   * preprocessing the model trains with. When false, the frame is squished
   * onto the square input instead, a comparison mode for models trained on
   * stretched data. A developer option, so squish only takes effect while
   * developerOptions is on and normal use always runs the center-crop path
   * that matches the model's training even if a stale false was left persisted.
   */
  centerCropFrames: boolean;
};

/**
 * The three development-only settings, the ones gated behind the
 * developerOptions master switch.
 */
export type DeveloperOptions = Pick<
  Settings,
  "showDebug" | "throttleInference" | "centerCropFrames"
>;

/**
 * Value exposed by the settings context via useSettings(). The three developer
 * options (showDebug, throttleInference, centerCropFrames) are the *effective*
 * values, already gated on developerOptions, so consumers never have to repeat
 * the gate. Each toggle still writes the stored value underneath.
 */
export type SettingsContextValue = {
  developerOptions: boolean;
  toggleDeveloperOptions: () => void;
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
    (value.developerOptions === undefined ||
      isBoolean(value.developerOptions)) &&
    (value.showDebug === undefined || isBoolean(value.showDebug)) &&
    (value.radarAudio === undefined || isBoolean(value.radarAudio)) &&
    (value.throttleInference === undefined ||
      isBoolean(value.throttleInference)) &&
    (value.centerCropFrames === undefined || isBoolean(value.centerCropFrames))
  );
};
