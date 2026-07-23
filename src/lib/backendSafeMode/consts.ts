/** localStorage key holding the armed safe-mode record. */
export const SAFE_MODE_STORAGE_KEY = "dashradar:backendSafeMode";

/**
 * Release identifier the safe-mode record is keyed to, matching the Sentry
 * release format in src/instrument.ts. A record armed under a different
 * release is discarded on read: every new deploy retries WebGPU once, since
 * the new build may contain the fix for whatever crashed the old one.
 */
export const SAFE_MODE_RELEASE = `dashradar@${__APP_VERSION__}+${__COMMIT_SHA__}`;
