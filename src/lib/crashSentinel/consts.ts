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
 * How a session's uptime is labelled for reporting, as ordered upper bounds in
 * milliseconds paired with the label a session under that bound gets. Anything
 * past the last bound takes UPTIME_BUCKET_OVERFLOW.
 *
 * A bucket exists because the raw millisecond count cannot be charted: a
 * reporting backend can group and filter on a handful of labels, but not on a
 * number that is distinct for every session, so a question as basic as whether
 * crashes moved earlier between two builds has to be answered by opening
 * reports one at a time. Bucketing trades resolution the answer never needed
 * for the ability to ask at all.
 *
 * The boundaries are fine early and coarse late because that is where the
 * evidence is: every kill observed so far landed inside the first half minute,
 * which is also the stretch the heartbeat covers at one-second resolution
 * (STARTUP_HEARTBEAT_INTERVAL_MS). Past the startup window the beat itself is
 * five seconds wide and a session that survived minutes did not die of
 * whatever startup does, so the labels widen to match.
 */
export const UPTIME_BUCKETS: readonly {
  readonly under: number;
  readonly label: string;
}[] = [
  { under: 1_000, label: "0-1s" },
  { under: 2_000, label: "1-2s" },
  { under: 5_000, label: "2-5s" },
  { under: 10_000, label: "5-10s" },
  { under: 30_000, label: "10-30s" },
  { under: 300_000, label: "30s-5m" },
];

/** Label for a session that outlived every bound in UPTIME_BUCKETS. */
export const UPTIME_BUCKET_OVERFLOW = "5m+";

/**
 * A dirty sentinel record found at next launch classifies as a "crash" when
 * the gap since its last heartbeat is within this window: iOS auto-reloads a
 * crashed foreground tab within seconds, so a short gap means the OS killed
 * and immediately relaunched the page. A longer gap (battery death, manual
 * restart, deliberate shutdown some time later) classifies as "unclean"
 * instead, since nothing points specifically at an OS-level kill.
 */
export const CRASH_RELAUNCH_WINDOW_MS = 60_000;
