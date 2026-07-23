import type { Settings } from "./types";

/** localStorage key holding the JSON-serialized Settings. */
export const STORAGE_KEY = "dashradar:settings";

/** Settings applied on first run or when stored settings are unavailable. */
export const DEFAULT_SETTINGS: Settings = {
  developerOptions: false,
  showDebug: false,
  radarAudio: true,
  throttleInference: true,
  centerCropFrames: true,
};
