import type { Settings } from "./types";

/** localStorage key holding the JSON-serialized Settings. */
export const STORAGE_KEY = "dashradar:settings";

/** Settings applied on first run or when stored settings are unavailable. */
export const DEFAULT_SETTINGS: Settings = {
  showVideo: true,
  showDebug: false,
  stabilizeMotion: false,
  radarDetectorMode: false,
};
