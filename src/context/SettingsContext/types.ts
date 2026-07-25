import { isBoolean, isNumber, isPlainObject } from "remeda";
import { CONFIDENCE_LEVELS } from "./consts";

/** User-controlled display options for the HUD. Serialized to localStorage. */
export type Settings = {
  /**
   * Master switch for the development-only settings (showDebug,
   * frameThumbnails, saveFrames, autoSaveFrames, throttleInference,
   * centerCropFrames, zoom2x, confidenceThreshold). Off by default. While it is off, SettingsProvider
   * reports each of those at its DEVELOPER_OPTIONS_OFF value no matter what is
   * stored, so a development tweak left enabled cannot alter a normal drive.
   * Their stored values survive, so turning this back on restores the tweaks
   * rather than resetting them.
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
   * When true, the contact card shows a thumbnail of what the model saw on
   * every scan, including scans with no detection, and stays lit rather than
   * fading out with the meter. A developer option, so it only takes effect
   * while developerOptions is on, and on by default there.
   */
  frameThumbnails: boolean;
  /**
   * When true, the contact card carries a SAVE button that downloads the full
   * inference frame as a JPEG, for collecting training data. Costs a JPEG
   * encode inside every detect round trip, so it is a developer option and only
   * takes effect while developerOptions is on.
   */
  saveFrames: boolean;
  /**
   * When true, every scan that detects something downloads its full inference
   * frame automatically, with no tap on SAVE. For collecting training data on
   * a drive, where reaching for the button on each detection is not practical
   * and the false positives are exactly what needs reviewing later. Implies
   * the frame encode saveFrames asks for. Off by default even under
   * developerOptions, since it downloads a file per detection.
   */
  autoSaveFrames: boolean;
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
  /**
   * When true, the worker halves the centered square it feeds the model, so
   * the same 512x512 input covers half the field of view and distant vehicles
   * occupy twice the linear size in the input grid. A digital crop rather than
   * the camera's own zoom, because native zoom is unavailable on iOS Safari
   * and uses device-defined units on Chrome Android; cropping ourselves is the
   * only way one setting means the same thing on both. A developer option, and
   * off by default even under developerOptions, since it narrows what the
   * detector can see.
   */
  zoom2x: boolean;
  /**
   * Minimum detection confidence. Detections scoring below this are discarded.
   * A developer option, so it only takes effect while developerOptions is on and
   * reports the 0.5 production floor (DEVELOPER_OPTIONS_OFF.confidenceThreshold)
   * otherwise, so a lowered value cannot loosen a normal drive. Constrained to
   * CONFIDENCE_LEVELS (0.1 to 0.9).
   */
  confidenceThreshold: number;
};

/**
 * The development-only settings, the ones gated behind the developerOptions
 * master switch.
 */
export type DeveloperOptions = Pick<
  Settings,
  | "showDebug"
  | "frameThumbnails"
  | "saveFrames"
  | "autoSaveFrames"
  | "throttleInference"
  | "centerCropFrames"
  | "zoom2x"
  | "confidenceThreshold"
>;

/**
 * Value exposed by the settings context via useSettings(). The developer
 * options (showDebug, frameThumbnails, saveFrames, autoSaveFrames,
 * throttleInference, centerCropFrames, zoom2x, confidenceThreshold) are the
 * *effective* values, already gated on developerOptions, so consumers never
 * have to repeat the gate. Each toggle (or setter) still writes the stored
 * value underneath.
 */
export type SettingsContextValue = {
  developerOptions: boolean;
  toggleDeveloperOptions: () => void;
  showDebug: boolean;
  toggleShowDebug: () => void;
  frameThumbnails: boolean;
  toggleFrameThumbnails: () => void;
  saveFrames: boolean;
  toggleSaveFrames: () => void;
  autoSaveFrames: boolean;
  toggleAutoSaveFrames: () => void;
  radarAudio: boolean;
  toggleRadarAudio: () => void;
  throttleInference: boolean;
  toggleThrottleInference: () => void;
  centerCropFrames: boolean;
  toggleCenterCropFrames: () => void;
  zoom2x: boolean;
  toggleZoom2x: () => void;
  confidenceThreshold: number;
  /** Sets the minimum-confidence level, snapping to the nearest allowed step. */
  setConfidenceThreshold: (level: number) => void;
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
    (value.frameThumbnails === undefined || isBoolean(value.frameThumbnails)) &&
    (value.saveFrames === undefined || isBoolean(value.saveFrames)) &&
    (value.autoSaveFrames === undefined || isBoolean(value.autoSaveFrames)) &&
    (value.radarAudio === undefined || isBoolean(value.radarAudio)) &&
    (value.throttleInference === undefined ||
      isBoolean(value.throttleInference)) &&
    (value.centerCropFrames === undefined ||
      isBoolean(value.centerCropFrames)) &&
    (value.zoom2x === undefined || isBoolean(value.zoom2x)) &&
    (value.confidenceThreshold === undefined ||
      isNumber(value.confidenceThreshold))
  );
};

/**
 * Normalizes any number to the nearest allowed confidence step. A non-finite
 * input (NaN, Infinity) resolves to the 0.5 default rather than an arbitrary
 * end of the range.
 */
export const snapConfidence = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return CONFIDENCE_LEVELS.reduce((best, level) =>
    Math.abs(level - value) < Math.abs(best - value) ? level : best,
  );
};
