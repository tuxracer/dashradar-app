import type { DevVideoContextValue } from "./types";

/**
 * Value seen by a consumer rendered outside DevVideoProvider. Unlike
 * SettingsContext this does not throw: DetectionProvider consumes it, and its
 * existing tests mount that provider on its own. A tree with no provider
 * behaves as one where no file has been chosen, which is the camera.
 */
export const DEV_VIDEO_FALLBACK: DevVideoContextValue = {
  source: null,
  setVideoFile: () => {},
  clearVideoFile: () => {},
};
