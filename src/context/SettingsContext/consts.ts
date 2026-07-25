import type { DeveloperOptions, Settings } from "./types";

/** localStorage key holding the JSON-serialized Settings. */
export const STORAGE_KEY = "dashradar:settings";

/** The discrete minimum-confidence steps the developer slider offers. */
export const CONFIDENCE_LEVELS = [
  0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9,
] as const;

/**
 * Settings applied on first run or when stored settings are unavailable. The
 * developer options take the value they should have once someone turns the
 * Developer options master switch on: the debug overlay, the per-scan frame
 * preview, and frame saving all default on, since turning developer options on
 * is itself the request to see and collect the diagnostics. What they report
 * while that switch is off is DEVELOPER_OPTIONS_OFF, not this.
 */
export const DEFAULT_SETTINGS: Settings = {
  developerOptions: false,
  showDebug: true,
  frameThumbnails: true,
  saveFrames: true,
  radarAudio: true,
  throttleInference: true,
  centerCropFrames: true,
  confidenceThreshold: 0.5,
};

/**
 * Effective values the development-only settings report while the Developer
 * options master switch is off: nothing extra on the glass, no per-frame JPEG
 * encode, the thermal pacing floor in place, the center crop the model trains
 * with, and the 0.5 confidence floor. Kept apart from DEFAULT_SETTINGS so a
 * developer option can default on for developers while staying off for a
 * normal drive.
 */
export const DEVELOPER_OPTIONS_OFF: DeveloperOptions = {
  showDebug: false,
  frameThumbnails: false,
  saveFrames: false,
  throttleInference: true,
  centerCropFrames: true,
  confidenceThreshold: 0.5,
};
