/**
 * Release identifier for the running build, in the Sentry release format. Also
 * stamped onto crash-sentinel records, so a record left by an older build is
 * never trusted for this one's decisions. The globals come from vite.config.ts.
 */
export const APP_RELEASE = `dashradar@${__APP_VERSION__}+${__COMMIT_SHA__}`;
