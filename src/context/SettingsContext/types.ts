import { isBoolean, isNumber, isPlainObject, isString } from "remeda";
import { CONFIDENCE_LEVELS } from "./consts";

/**
 * Crop-factor modes the zoom setting offers. "1x" scans the full
 * centered square, "2x" always scans the half-side crop, and "auto" lets the
 * detection loop pick per scan: alternating between the two while nothing is
 * detected, then locking or zooming based on where the detection sits (see
 * src/lib/autoZoom).
 */
export type ZoomMode = "1x" | "2x" | "auto";

const ZOOM_MODES: readonly ZoomMode[] = ["1x", "2x", "auto"];

/** Validates a persisted or otherwise untrusted value as a ZoomMode. */
export const isZoomMode = (value: unknown): value is ZoomMode => {
  return isString(value) && ZOOM_MODES.includes(value as ZoomMode);
};

/** User-controlled display options for the HUD. Serialized to localStorage. */
export type Settings = {
  /**
   * Master switch for the development-only settings (showDebug,
   * frameThumbnails, saveFrames, autoSaveFrames, throttleInference,
   * zoomMode, confidenceThreshold, zoomIndicator,
   * roundTripIndicator, cameraPreview). Off by
   * default. While it is off, SettingsProvider
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
   * When true, the contact card carries a SAVE button that downloads the
   * model's square input frame as a JPEG, for collecting training data. Costs
   * a JPEG encode inside every detect round trip, so it is a developer option
   * and only takes effect while developerOptions is on.
   */
  saveFrames: boolean;
  /**
   * When true, every scan that detects something downloads its model-input
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
   * When true, a detection puts a card on the glass showing the picture the
   * detector cut out of the frame. On by default. Off turns the card off
   * outright: the worker skips the cutout, so no image of what was detected is
   * ever produced. The two card-related developer options ride on top of it and
   * do nothing while it is off, since there is no card for the per-scan preview
   * to extend or the SAVE button to sit in.
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
   * distant vehicles occupy twice the linear size in the input grid; "auto"
   * alternates between 1x and 2x while nothing is detected and locks or zooms
   * per scan once something is (src/lib/autoZoom). A digital crop rather than
   * the camera's own zoom, because native zoom is unavailable on iOS Safari
   * and uses device-defined units on Chrome Android; cropping ourselves is the
   * only way one setting means the same thing on both. Defaults to "auto",
   * the production scanning behavior; the developer row exists to override it
   * with a fixed 1x or 2x for testing, and that override only takes effect
   * while developerOptions is on.
   */
  zoomMode: ZoomMode;
  /**
   * Minimum detection confidence. Detections scoring below this are discarded.
   * A developer option, so it only takes effect while developerOptions is on and
   * reports the 0.5 production floor (DEVELOPER_OPTIONS_OFF.confidenceThreshold)
   * otherwise, so a lowered value cannot loosen a normal drive. Constrained to
   * CONFIDENCE_LEVELS (0.1 to 0.9).
   */
  confidenceThreshold: number;
  /**
   * When true, an amber pill on the status bar line shows the crop factor the
   * detector is scanning at, including the auto mode's live level and lock
   * state. A developer option, so it only takes effect while developerOptions
   * is on, and on by default there: it is the on-glass counterpart of the
   * debug overlay's zoom row.
   */
  zoomIndicator: boolean;
  /**
   * When true, an amber pill on the status bar line shows the last scan's
   * round-trip time, the whole detect message round trip rather than the model
   * time alone. A developer option, so it only takes effect while
   * developerOptions is on, and on by default there: it is the on-glass
   * counterpart of the debug overlay's round-trip row, for watching pacing on
   * a phone without the full panel covering the meter.
   */
  roundTripIndicator: boolean;
  /**
   * When true, a small live view of the region the detector is scanning (the
   * centered square crop, narrowed further under the digital zoom) renders on
   * the glass: on the left edge in landscape, top center under the status
   * pills in portrait. A developer option, so it only takes effect while
   * developerOptions is on. Off by default even there: the app deliberately
   * never shows the feed, and a second live video surface costs compositing
   * on a thermally constrained device, so it is worth asking for by name.
   */
  cameraPreview: boolean;
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
  | "zoomMode"
  | "confidenceThreshold"
  | "zoomIndicator"
  | "roundTripIndicator"
  | "cameraPreview"
>;

/**
 * Value exposed by the settings context via useSettings(). The developer
 * options (showDebug, frameThumbnails, saveFrames, autoSaveFrames,
 * throttleInference, zoomMode, confidenceThreshold,
 * zoomIndicator, roundTripIndicator, cameraPreview) are the
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
  detectionImage: boolean;
  toggleDetectionImage: () => void;
  throttleInference: boolean;
  toggleThrottleInference: () => void;
  zoomMode: ZoomMode;
  /** Sets the zoom mode (1x, 2x, or auto). */
  setZoomMode: (mode: ZoomMode) => void;
  confidenceThreshold: number;
  /** Sets the minimum-confidence level, snapping to the nearest allowed step. */
  setConfidenceThreshold: (level: number) => void;
  zoomIndicator: boolean;
  toggleZoomIndicator: () => void;
  roundTripIndicator: boolean;
  toggleRoundTripIndicator: () => void;
  cameraPreview: boolean;
  toggleCameraPreview: () => void;
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
    (value.detectionImage === undefined || isBoolean(value.detectionImage)) &&
    (value.throttleInference === undefined ||
      isBoolean(value.throttleInference)) &&
    (value.zoomMode === undefined || isZoomMode(value.zoomMode)) &&
    (value.confidenceThreshold === undefined ||
      isNumber(value.confidenceThreshold)) &&
    (value.zoomIndicator === undefined || isBoolean(value.zoomIndicator)) &&
    (value.roundTripIndicator === undefined ||
      isBoolean(value.roundTripIndicator)) &&
    (value.cameraPreview === undefined || isBoolean(value.cameraPreview))
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
