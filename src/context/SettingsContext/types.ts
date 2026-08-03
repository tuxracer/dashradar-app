import { isArray, isBoolean, isNumber, isPlainObject, isString } from "remeda";
import { CONFIDENCE_THRESHOLD } from "@/lib/detection";
import { CONFIDENCE_LEVELS } from "./consts";

/**
 * Crop-factor modes the zoom setting offers. "1x" scans the full centered
 * square, "2x" scans the half-side crop.
 */
export type ZoomMode = "1x" | "2x";

const ZOOM_MODES: readonly ZoomMode[] = ["1x", "2x"];

/** Validates a persisted or otherwise untrusted value as a ZoomMode. */
export const isZoomMode = (value: unknown): value is ZoomMode => {
  return isString(value) && ZOOM_MODES.includes(value as ZoomMode);
};

/** User-controlled display options for the HUD. Serialized to localStorage. */
export type Settings = {
  /**
   * Master switch for the development-only settings (showDebug,
   * throttleInference, zoomMode, confidenceThreshold, modelIds,
   * zoomIndicator, roundTripIndicator, cameraPreview, detectionView,
   * rawConfidence). Off by default. While it is off, SettingsProvider
   * reports each of those at its DEVELOPER_OPTIONS_OFF value no matter what is
   * stored, so a development tweak left enabled cannot alter a normal drive.
   * Their stored values survive, so turning this back on restores the tweaks
   * rather than resetting them. Turning it on has no other effect: every
   * developer option starts at its off value, so the switch reveals the rows
   * and nothing more until someone taps one.
   */
  developerOptions: boolean;
  /**
   * When true, an on-screen debug overlay renders performance and development
   * diagnostics (timing, detection counts, system info). A developer option, so
   * it only takes effect while developerOptions is on, and off until asked for
   * there.
   */
  showDebug: boolean;
  /**
   * When true, radar detector mode beeps as a police vehicle is detected:
   * the beeps pulse faster (and higher-pitched) the stronger the signal, and
   * stop entirely when nothing is detected. On by default.
   */
  radarAudio: boolean;
  /**
   * When true, a detection puts a card on the glass showing the picture the
   * detector cut out of the frame. Off by default: the meter alone is what a
   * driver reads at a glance, and the card costs a crop on every detection.
   * Off turns the card off outright rather than hiding it, so no image of what
   * was detected is ever produced.
   */
  detectionImage: boolean;
  /**
   * When false, the detection pump runs inference flat-out with no pacing
   * floor. A developer option, so it only takes effect while developerOptions
   * is on and a phone can never run unthrottled otherwise. On by default: the
   * 2s pacing floor is the app's thermal/battery safeguard.
   */
  throttleInference: boolean;
  /**
   * Crop factor the worker scans at. "2x" halves the centered square fed to
   * the model, so the same 512x512 input covers half the field of view and
   * distant vehicles occupy twice the linear size in the input grid. A digital
   * crop rather than the camera's own zoom, because native zoom is unavailable
   * on iOS Safari and uses device-defined units on Chrome Android; cropping
   * ourselves is the only way one setting means the same thing on both. A
   * developer option: it only takes effect while developerOptions is on, and a
   * normal drive always scans the full 1x square.
   */
  zoomMode: ZoomMode;
  /**
   * Which detection models the app runs, by registry id. A list rather than a
   * single id so multi-model selection needs no settings migration later, even
   * though MAX_SELECTED_MODELS caps it at one today. Ids are stored unresolved
   * and resolved through resolveModels at the point of use, so an id left by a
   * build that had a model this one does not degrades to the shipping model
   * instead of invalidating the whole blob. A developer option, so it only
   * takes effect while developerOptions is on and the app runs the shipping
   * model otherwise.
   */
  modelIds: readonly string[];
  /**
   * Minimum detection confidence. Detections scoring below this are discarded.
   * A developer option, so it only takes effect while developerOptions is on and
   * reports the production floor (DEVELOPER_OPTIONS_OFF.confidenceThreshold)
   * otherwise, so a lowered value cannot loosen a normal drive. Constrained to
   * CONFIDENCE_LEVELS (0.1 to 0.9).
   */
  confidenceThreshold: number;
  /**
   * When true, an amber pill on the status bar line shows the crop factor the
   * detector is scanning at. A developer option, so it only takes effect
   * while developerOptions is on, and off until asked for there: it is the
   * on-glass counterpart of the debug overlay's zoom row.
   */
  zoomIndicator: boolean;
  /**
   * When true, an amber pill on the status bar line shows the last scan's
   * round-trip time, the whole detect message round trip rather than the model
   * time alone. A developer option, so it only takes effect while
   * developerOptions is on, and off until asked for there: it is the on-glass
   * counterpart of the debug overlay's round-trip row, for watching pacing on
   * a phone without the full panel covering the meter.
   */
  roundTripIndicator: boolean;
  /**
   * When true, a small live view of the region the detector is scanning (the
   * centered square crop, narrowed further under the digital zoom) renders on
   * the glass: on the left edge in landscape, top center under the status
   * pills in portrait. A developer option, so it only takes effect while
   * developerOptions is on: the app deliberately never shows the feed, and a
   * second live video surface costs compositing on a thermally constrained
   * device.
   */
  cameraPreview: boolean;
  /**
   * When true, the radar meter is replaced by the live feed at full screen
   * with the model's detection boxes drawn over it, plus an outline of the
   * region the model is actually shown. For checking aim, framing, and false
   * positives against what the detector really sees. A developer option, so it
   * only takes effect while developerOptions is on: the app deliberately never
   * shows the feed, and the meter is what a driver reads. Replacing the meter
   * also takes the beeper and the contact card off, since both live inside it.
   */
  detectionView: boolean;
  /**
   * When true, the dial readout shows the model's raw detection score in
   * [0, 1] instead of the percentage. The percentage derives from a remapped
   * signal band (the [SIGNAL_FLOOR, 1] score band stretched over the full
   * meter, see radarSignal), so it never matches the model's own confidence;
   * this row shows the score before that remap, for judging the model rather
   * than the meter. The ladder segments keep tracking the remapped signal
   * either way. A developer option, so it only takes effect while
   * developerOptions is on, and off until asked for there.
   */
  rawConfidence: boolean;
};

/**
 * The settings blob as it lives in localStorage: the settings themselves plus
 * the schema version a load-time migration keys off. The version is not a
 * setting, so it never reaches consumers.
 */
export type PersistedSettings = Settings & {
  settingsVersion: number;
};

/**
 * The development-only settings, the ones gated behind the developerOptions
 * master switch.
 */
export type DeveloperOptions = Pick<
  Settings,
  | "showDebug"
  | "throttleInference"
  | "zoomMode"
  | "confidenceThreshold"
  | "modelIds"
  | "zoomIndicator"
  | "roundTripIndicator"
  | "cameraPreview"
  | "detectionView"
  | "rawConfidence"
>;

/**
 * Value exposed by the settings context via useSettings(). The developer
 * options (showDebug, throttleInference, zoomMode, confidenceThreshold,
 * modelIds, zoomIndicator,
 * roundTripIndicator, cameraPreview, detectionView, rawConfidence) are the
 * *effective* values, already gated on developerOptions, so consumers never
 * have to repeat the gate. Each toggle (or setter) still writes the stored
 * value underneath.
 */
export type SettingsContextValue = {
  developerOptions: boolean;
  toggleDeveloperOptions: () => void;
  showDebug: boolean;
  toggleShowDebug: () => void;
  radarAudio: boolean;
  toggleRadarAudio: () => void;
  detectionImage: boolean;
  toggleDetectionImage: () => void;
  throttleInference: boolean;
  toggleThrottleInference: () => void;
  zoomMode: ZoomMode;
  /** Sets the zoom mode (1x or 2x). */
  setZoomMode: (mode: ZoomMode) => void;
  modelIds: readonly string[];
  /**
   * Writes a model selection straight to localStorage and reports whether the
   * write landed. Deliberately not a plain setState: the caller reloads the
   * page immediately afterwards to apply the change, which would outrun the
   * persist effect every other setter relies on. The in-memory value follows a
   * write that landed, so a caller that decides not to reload is not left out
   * of step. A false return means storage refused the write (private mode,
   * quota), so the caller must not reload.
   */
  commitModelIds: (ids: readonly string[]) => boolean;
  confidenceThreshold: number;
  /** Sets the minimum-confidence level, snapping to the nearest allowed step. */
  setConfidenceThreshold: (level: number) => void;
  zoomIndicator: boolean;
  toggleZoomIndicator: () => void;
  roundTripIndicator: boolean;
  toggleRoundTripIndicator: () => void;
  cameraPreview: boolean;
  toggleCameraPreview: () => void;
  detectionView: boolean;
  toggleDetectionView: () => void;
  rawConfidence: boolean;
  toggleRawConfidence: () => void;
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
): value is Partial<PersistedSettings> => {
  return (
    isPlainObject(value) &&
    (value.settingsVersion === undefined || isNumber(value.settingsVersion)) &&
    (value.developerOptions === undefined ||
      isBoolean(value.developerOptions)) &&
    (value.showDebug === undefined || isBoolean(value.showDebug)) &&
    (value.radarAudio === undefined || isBoolean(value.radarAudio)) &&
    (value.detectionImage === undefined || isBoolean(value.detectionImage)) &&
    (value.throttleInference === undefined ||
      isBoolean(value.throttleInference)) &&
    (value.zoomMode === undefined || isZoomMode(value.zoomMode)) &&
    (value.confidenceThreshold === undefined ||
      isNumber(value.confidenceThreshold)) &&
    (value.modelIds === undefined ||
      (isArray(value.modelIds) && value.modelIds.every(isString))) &&
    (value.zoomIndicator === undefined || isBoolean(value.zoomIndicator)) &&
    (value.roundTripIndicator === undefined ||
      isBoolean(value.roundTripIndicator)) &&
    (value.cameraPreview === undefined || isBoolean(value.cameraPreview)) &&
    (value.detectionView === undefined || isBoolean(value.detectionView)) &&
    (value.rawConfidence === undefined || isBoolean(value.rawConfidence))
  );
};

/**
 * Normalizes any number to the nearest allowed confidence step. A non-finite
 * input (NaN, Infinity) resolves to the production floor rather than an
 * arbitrary end of the range, so a corrupt stored value lands on the setting a
 * normal drive runs at instead of the loosest or strictest step there is.
 */
export const snapConfidence = (value: number): number => {
  if (!Number.isFinite(value)) {
    return CONFIDENCE_THRESHOLD;
  }
  return CONFIDENCE_LEVELS.reduce((best, level) =>
    Math.abs(level - value) < Math.abs(best - value) ? level : best,
  );
};
