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
 * is itself the request to see and collect the diagnostics. Auto save and the
 * camera preview are the exceptions, defaulting off: auto save downloads a
 * file per detection, and the camera preview puts a live video surface on the
 * glass, so each is worth asking for deliberately rather than inheriting. The
 * zoom defaults to
 * auto, the production behavior, so the developer row is an override for
 * pinning a fixed 1x or 2x during testing. What the developer options report
 * while the master switch is off is DEVELOPER_OPTIONS_OFF, not this.
 */
export const DEFAULT_SETTINGS: Settings = {
  developerOptions: false,
  showDebug: true,
  frameThumbnails: true,
  saveFrames: true,
  autoSaveFrames: false,
  radarAudio: true,
  detectionImage: true,
  throttleInference: true,
  zoomMode: "auto",
  confidenceThreshold: 0.5,
  zoomIndicator: true,
  roundTripIndicator: true,
  cameraPreview: false,
};

/**
 * Effective values the development-only settings report while the Developer
 * options master switch is off: nothing extra on the glass (no debug overlay,
 * no zoom or round-trip pill, no camera preview), no per-frame JPEG
 * encode, no downloads, the thermal pacing floor in place, the auto zoom (the
 * production scanning behavior), and the 0.5 confidence floor.
 * Kept apart from
 * DEFAULT_SETTINGS so a developer option can default on for developers while
 * staying off for a normal drive.
 */
export const DEVELOPER_OPTIONS_OFF: DeveloperOptions = {
  showDebug: false,
  frameThumbnails: false,
  saveFrames: false,
  autoSaveFrames: false,
  throttleInference: true,
  zoomMode: "auto",
  confidenceThreshold: 0.5,
  zoomIndicator: false,
  roundTripIndicator: false,
  cameraPreview: false,
};
