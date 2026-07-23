/**
 * Build-time release identifier for the running build, in the Sentry release
 * format. Shared by Sentry init (src/instrument.ts), the backend safe mode
 * (which keys its crash streak to a release), and the crash sentinel (which
 * stamps heartbeat records with the release that wrote them, so a record left
 * by an older build is never trusted for the current build's decisions).
 * __APP_VERSION__ and __COMMIT_SHA__ are injected by vite.config.ts.
 */
export const APP_RELEASE = `dashradar@${__APP_VERSION__}+${__COMMIT_SHA__}`;
