import { CONFIDENCE_THRESHOLD } from "@/lib/detection";
import { DEFAULT_MODEL } from "@/lib/detectionModels";
import { SCENE_FOV_DEG_DEFAULT } from "@/lib/scenePlacement";
import type { DeveloperOptions, Settings } from "./types";

/** localStorage key holding the JSON-serialized Settings. */
export const STORAGE_KEY = "settings";

/**
 * Schema version stamped on the persisted blob, so a one-time migration can tell
 * an older build's blob from this build's.
 */
export const SETTINGS_VERSION = 1;

/** The discrete minimum-confidence steps the developer slider offers. */
export const CONFIDENCE_LEVELS = [
  0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9,
] as const;

/**
 * What the developer options report while the master switch is off: nothing extra
 * on the glass, every safeguard in place. The confidence floor is
 * CONFIDENCE_THRESHOLD itself rather than a copy, so the state every driver runs
 * in cannot disagree with the one the detector filters at. Also the values every
 * developer option starts at, so the two switch states agree until someone taps.
 */
export const DEVELOPER_OPTIONS_OFF: DeveloperOptions = {
  showDebug: false,
  throttleInference: true,
  sceneChangeGate: true,
  zoomMode: "1x",
  confidenceThreshold: CONFIDENCE_THRESHOLD,
  sceneFov: SCENE_FOV_DEG_DEFAULT,
  zoomIndicator: false,
  roundTripIndicator: false,
  cameraPreview: false,
  detectionView: false,
  rawConfidence: false,
  consoleDiagnostics: false,
};

/**
 * Settings applied on first run or when storage is unavailable. Every developer
 * option starts at its off value, so the master switch only reveals rows.
 */
export const DEFAULT_SETTINGS: Settings = {
  developerOptions: false,
  radarAudio: true,
  viewMode: "radar",
  detectionImage: false,
  modelIds: [DEFAULT_MODEL.id],
  ...DEVELOPER_OPTIONS_OFF,
};
