import {
  clamp,
  entries,
  isArray,
  isBoolean,
  isNumber,
  isPlainObject,
  isString,
} from "remeda";
import { CONFIDENCE_THRESHOLD } from "@/lib/detection";
import {
  SCENE_FOV_DEG_DEFAULT,
  SCENE_FOV_DEG_MAX,
  SCENE_FOV_DEG_MIN,
} from "@/lib/scenePlacement";
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

/**
 * Main views the driver can put on the glass: the radar dial or the 3D scene.
 */
export type ViewMode = "radar" | "scene";

const VIEW_MODES: readonly ViewMode[] = ["radar", "scene"];

/** Validates a persisted or otherwise untrusted value as a ViewMode. */
export const isViewMode = (value: unknown): value is ViewMode => {
  return isString(value) && VIEW_MODES.includes(value as ViewMode);
};

/**
 * User-controlled display options for the HUD, serialized to localStorage.
 * Everything in `DeveloperOptions` below is gated: while `developerOptions` is
 * off, SettingsProvider reports those at their DEVELOPER_OPTIONS_OFF value
 * whatever is stored, so a tweak left enabled cannot alter a normal drive.
 */
export type Settings = {
  /**
   * Master switch for the developer options. Their stored values survive it, and
   * every one starts at its off value, so the switch reveals rows and no more.
   */
  developerOptions: boolean;
  showDebug: boolean;
  /**
   * Whether the meter beeps at a detection, faster and higher the stronger the
   * signal.
   */
  radarAudio: boolean;
  /**
   * Whether a detection puts a card on the glass showing the picture cut out of
   * the frame. Off turns the card off outright rather than hiding it, so no
   * image of what was detected is ever produced.
   */
  detectionImage: boolean;
  /** Which main view the driver sees; the status-bar button is its only control. */
  viewMode: ViewMode;
  /**
   * Whether the pump paces itself. Off runs inference flat-out, which is why it
   * is gated: the pacing floor is the app's thermal safeguard.
   */
  throttleInference: boolean;
  /**
   * Whether frames whose picture has not moved skip the model. Gated so the
   * gate's effect can be measured against its absence on a device; a normal
   * drive always runs it.
   */
  sceneChangeGate: boolean;
  /** Crop factor the worker scans at; "2x" halves the square fed to the model. */
  zoomMode: ZoomMode;
  /**
   * Which detection models the app runs, by registry id. A list so multi-model
   * selection needs no migration later. Stored unresolved, so an id this build
   * does not know degrades to the shipping model rather than invalidating the
   * blob. Ungated, or someone could save a model the app then refused to load.
   */
  modelIds: readonly string[];
  /** Minimum detection confidence, constrained to CONFIDENCE_LEVELS. */
  confidenceThreshold: number;
  /**
   * The camera's full-frame horizontal field of view in whole degrees, which
   * calibrates how far away the scene view places what it detects.
   */
  sceneFov: number;
  /** Whether a status-bar pill shows the crop factor being scanned at. */
  zoomIndicator: boolean;
  /**
   * Whether a status-bar pill shows the last scan's round trip, for watching
   * pacing on a phone without the debug panel covering the meter.
   */
  roundTripIndicator: boolean;
  /**
   * Whether a small live view of the scanned region renders on the glass. Gated:
   * the app deliberately never shows the feed, and a second video surface costs
   * compositing on a thermally constrained device.
   */
  cameraPreview: boolean;
  /**
   * Whether the meter is replaced by the full-screen feed with the model's boxes
   * drawn over it, for checking aim and false positives. Takes the beeper and
   * the contact card with it, since both live inside the meter.
   */
  detectionView: boolean;
  /**
   * Whether the dial reads out the model's raw score instead of the percentage.
   * The percentage comes off a remapped signal band, so it never matches the
   * model's own confidence; this is for judging the model rather than the meter.
   */
  rawConfidence: boolean;
  /**
   * Whether the engine mirrors its session log to the console, for tethered Web
   * Inspector sessions.
   */
  consoleDiagnostics: boolean;
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
  | "sceneChangeGate"
  | "zoomMode"
  | "confidenceThreshold"
  | "sceneFov"
  | "zoomIndicator"
  | "roundTripIndicator"
  | "cameraPreview"
  | "detectionView"
  | "rawConfidence"
  | "consoleDiagnostics"
>;

/**
 * The boolean settings a single toggle action can flip, derived from the
 * Settings shape so a new boolean row needs no store change.
 */
export type BooleanSettingKey = {
  [K in keyof Settings]: Settings[K] extends boolean ? K : never;
}[keyof Settings];

/**
 * What the store publishes: the driver-facing values as stored, the developer
 * options at their *effective* (already-gated) values so consumers never
 * repeat the gate, and the ephemeral panel state. Replaced wholesale on
 * change (the useSyncExternalStore contract).
 */
export type SettingsSnapshot = DeveloperOptions & {
  developerOptions: boolean;
  radarAudio: boolean;
  viewMode: ViewMode;
  detectionImage: boolean;
  modelIds: readonly string[];
  /** Whether the full-screen settings panel is open. Ephemeral, not persisted. */
  settingsOpen: boolean;
};

/**
 * The settings state machine, framework-free: one stored Settings object,
 * persisted on every change, published as an effective snapshot. Toggles and
 * setters write the stored value underneath the gate, so turning developer
 * options off and on restores tweaks rather than resetting them.
 */
export type SettingsStore = {
  getSnapshot: () => SettingsSnapshot;
  /** Register for snapshot changes; returns the unsubscribe. */
  subscribe: (onChange: () => void) => () => void;
  toggle: (key: BooleanSettingKey) => void;
  /** Sets the zoom mode (1x or 2x). */
  setZoomMode: (mode: ZoomMode) => void;
  /** Sets the main view (radar dial or 3D scene). */
  setViewMode: (mode: ViewMode) => void;
  /** Sets the minimum-confidence level, snapping to the nearest allowed step. */
  setConfidenceThreshold: (level: number) => void;
  /** Sets the scene field of view in degrees, snapped to the allowed range. */
  setSceneFov: (deg: number) => void;
  /**
   * Writes a model selection straight to localStorage and reports whether it
   * landed. Synchronous because the caller reloads on the next line: a false
   * return means storage refused, so it must not.
   */
  commitModelIds: (ids: readonly string[]) => boolean;
  /** Open or close the full-screen settings panel (ephemeral state). */
  setSettingsOpen: (open: boolean) => void;
};

/** Validates a persisted value as the stored list of model ids. */
const isModelIds = (value: unknown): value is readonly string[] =>
  isArray(value) && value.every(isString);

/**
 * How each field of the persisted blob is checked. The mapped type is the point:
 * a new setting with no entry here is a compile error rather than a field that
 * reaches app state unvalidated.
 */
const FIELD_VALIDATORS: {
  [K in keyof PersistedSettings]: (
    value: unknown,
  ) => value is PersistedSettings[K];
} = {
  settingsVersion: isNumber,
  developerOptions: isBoolean,
  showDebug: isBoolean,
  radarAudio: isBoolean,
  detectionImage: isBoolean,
  viewMode: isViewMode,
  throttleInference: isBoolean,
  sceneChangeGate: isBoolean,
  zoomMode: isZoomMode,
  confidenceThreshold: isNumber,
  sceneFov: isNumber,
  modelIds: isModelIds,
  zoomIndicator: isBoolean,
  roundTripIndicator: isBoolean,
  cameraPreview: isBoolean,
  detectionView: isBoolean,
  rawConfidence: isBoolean,
  consoleDiagnostics: isBoolean,
};

/**
 * Validates a value parsed from localStorage. Fields are optional-but-typed, so a
 * blob from another build still validates and loadSettings fills the gaps; a
 * field present with the wrong type rejects the whole blob back to defaults.
 */
export const isPersistedSettings = (
  value: unknown,
): value is Partial<PersistedSettings> =>
  isPlainObject(value) &&
  entries(FIELD_VALIDATORS).every(
    ([key, isValid]) => value[key] === undefined || isValid(value[key]),
  );

/**
 * Snaps to the nearest allowed confidence step. A non-finite input resolves to
 * the production floor, so a corrupt stored value lands on the setting a normal
 * drive runs at rather than the loosest or strictest step there is.
 */
export const snapConfidence = (value: number): number => {
  if (!Number.isFinite(value)) {
    return CONFIDENCE_THRESHOLD;
  }
  return CONFIDENCE_LEVELS.reduce((best, level) =>
    Math.abs(level - value) < Math.abs(best - value) ? level : best,
  );
};

/**
 * Snaps to a whole degree inside the scene FoV range. A non-finite input
 * resolves to the default, so a corrupt stored value lands on the lens a normal
 * drive assumes rather than an arbitrary end of the range.
 */
export const snapSceneFov = (value: number): number => {
  if (!Number.isFinite(value)) {
    return SCENE_FOV_DEG_DEFAULT;
  }
  return clamp(Math.round(value), {
    min: SCENE_FOV_DEG_MIN,
    max: SCENE_FOV_DEG_MAX,
  });
};
