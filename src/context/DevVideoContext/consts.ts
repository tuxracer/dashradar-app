import { DEV_VIDEO_URL } from "@/lib/devVideo";
import type { DevVideoContextValue, DevVideoSource } from "./types";

/**
 * The startup feed: the clip named by DASHRADAR_VIDEO, or null for the camera.
 * Production builds compile DEV_VIDEO_URL to null, so a production session
 * always starts on the camera until a file is dropped or picked.
 */
export const ENV_VIDEO_SOURCE: DevVideoSource | null = DEV_VIDEO_URL
  ? { url: DEV_VIDEO_URL, name: "DASHRADAR_VIDEO" }
  : null;

/**
 * Value seen by a consumer rendered outside DevVideoProvider. Unlike
 * SettingsContext this does not throw: DetectionProvider consumes it, and its
 * existing tests mount that provider on its own. The default reproduces the
 * pre-drop behavior exactly, which was keyed on DEV_VIDEO_URL alone.
 */
export const DEV_VIDEO_FALLBACK: DevVideoContextValue = {
  source: ENV_VIDEO_SOURCE,
  overridden: false,
  setVideoFile: () => {},
  clearVideoFile: () => {},
};
