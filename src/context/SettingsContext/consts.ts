import { DEFAULT_MODEL } from "@/lib/detectionModels";
import type { DeveloperOptions, Settings } from "./types";

/** localStorage key holding the JSON-serialized Settings. */
export const STORAGE_KEY = "settings";

/**
 * Schema version stamped on the persisted blob, so a one-time migration can
 * tell a blob written by an older build from one this build wrote. Version 1
 * is the first to stop defaulting developer options on (see
 * clearLegacyDefaultOnOptions in index.tsx); a blob with no version at all
 * predates it.
 */
export const SETTINGS_VERSION = 1;

/** The discrete minimum-confidence steps the developer slider offers. */
export const CONFIDENCE_LEVELS = [
  0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9,
] as const;

/**
 * Effective values the development-only settings report while the Developer
 * options master switch is off: nothing extra on the glass (no debug overlay,
 * no zoom or round-trip pill, no camera preview, no detection view), no
 * per-frame JPEG encode, no downloads, the thermal pacing floor in place, the
 * auto zoom (the production scanning behavior), the 0.5 confidence floor, the
 * percentage readout, and the shipping detection model. These are also the
 * values every developer option starts at (DEFAULT_SETTINGS builds on them), so
 * the two switch states agree until someone changes a row by hand.
 */
export const DEVELOPER_OPTIONS_OFF: DeveloperOptions = {
  showDebug: false,
  frameThumbnails: false,
  saveFrames: false,
  autoSaveFrames: false,
  throttleInference: true,
  zoomMode: "auto",
  confidenceThreshold: 0.5,
  modelIds: [DEFAULT_MODEL.id],
  zoomIndicator: false,
  roundTripIndicator: false,
  cameraPreview: false,
  detectionView: false,
  rawConfidence: false,
};

/**
 * Settings applied on first run or when stored settings are unavailable. Every
 * developer option starts at its DEVELOPER_OPTIONS_OFF value, so turning the
 * Developer options master switch on only reveals the rows: it never turns
 * anything on or off by itself. A row changes only when someone taps it, and
 * that choice is what gets stored.
 */
export const DEFAULT_SETTINGS: Settings = {
  developerOptions: false,
  radarAudio: true,
  detectionImage: false,
  ...DEVELOPER_OPTIONS_OFF,
};
