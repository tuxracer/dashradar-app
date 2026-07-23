/**
 * URL of the dev video file that substitutes for the camera feed, or null
 * when the app runs against the real camera. Non-null only in `pnpm dev`
 * with DASHRADAR_VIDEO set (see the devVideo plugin in vite.config.ts);
 * production builds compile this to null, so every branch keyed on it is
 * statically dead code there.
 */
export const DEV_VIDEO_URL: string | null = __DEV_VIDEO_URL__;
