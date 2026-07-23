/** localStorage key for the in-progress session heartbeat record. */
export const SENTINEL_STORAGE_KEY = "dashradar:sessionSentinel";

/** Cadence of heartbeat writes while detection is running. */
export const HEARTBEAT_INTERVAL_MS = 5_000;

/**
 * A dirty sentinel record found at next launch classifies as a "crash" when
 * the gap since its last heartbeat is within this window: iOS auto-reloads a
 * crashed foreground tab within seconds, so a short gap means the OS killed
 * and immediately relaunched the page. A longer gap (battery death, manual
 * restart, deliberate shutdown some time later) classifies as "unclean"
 * instead, since nothing points specifically at an OS-level kill.
 */
export const CRASH_RELAUNCH_WINDOW_MS = 60_000;
