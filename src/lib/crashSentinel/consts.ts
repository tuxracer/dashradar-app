/** localStorage key for the in-progress session heartbeat record. */
export const SENTINEL_STORAGE_KEY = "sessionSentinel";

/** Cadence of heartbeat writes once a session is past its startup window. */
export const HEARTBEAT_INTERVAL_MS = 5_000;

/**
 * Heartbeat cadence for the first STARTUP_HEARTBEAT_WINDOW_MS of scanning.
 * Every OS-level kill observed in the field so far (DASHRADAR-2, all of them on
 * WebKit) landed within ~21 s of the pump starting, and several before the
 * second beat ever ran. At the steady cadence alone that whole population
 * collapses onto three uptime values (0, 5001, 10002), which says the page died
 * early but nothing about where in startup, and startup is where the session
 * compiles shaders, allocates its GPU buffers, and brings the camera up. One
 * second tells those apart. The extra writes are bounded to the window and stop
 * on their own, so a multi-hour drive still pays only the steady cadence.
 */
export const STARTUP_HEARTBEAT_INTERVAL_MS = 1_000;

/**
 * How long after scanning starts the faster cadence above applies. Set well
 * past the ~21 s worst case observed so the window covers the known crash
 * population with headroom instead of sitting at its edge.
 */
export const STARTUP_HEARTBEAT_WINDOW_MS = 30_000;

/**
 * A dirty sentinel record found at next launch classifies as a "crash" when
 * the gap since its last heartbeat is within this window: iOS auto-reloads a
 * crashed foreground tab within seconds, so a short gap means the OS killed
 * and immediately relaunched the page. A longer gap (battery death, manual
 * restart, deliberate shutdown some time later) classifies as "unclean"
 * instead, since nothing points specifically at an OS-level kill.
 */
export const CRASH_RELAUNCH_WINDOW_MS = 60_000;
