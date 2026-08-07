/** localStorage key for the in-progress session heartbeat record. */
export const SENTINEL_STORAGE_KEY = "sessionSentinel";

/**
 * Entries the rolling session log keeps. The whole log is rewritten per
 * heartbeat, so this decides the cost of a beat: twenty short entries is about a
 * kilobyte, which a synchronous write absorbs at one per second. It is also
 * about twenty seconds of scanning, which reaches back past the start of the
 * kills it exists to explain.
 */
export const MAX_SESSION_EVENTS = 20;

/** Cadence of heartbeat writes once a session is past its startup window. */
export const HEARTBEAT_INTERVAL_MS = 5_000;

/**
 * Heartbeat cadence through the startup window. Every OS kill observed so far
 * landed within about 21 s of the pump starting, and at the steady cadence that
 * whole population collapses onto three uptime values, which says the page died
 * early but nothing about where in startup, the stretch that compiles shaders,
 * allocates GPU buffers, and brings the camera up. The extra writes stop with
 * the window, so a long drive pays only the steady cadence.
 */
export const STARTUP_HEARTBEAT_INTERVAL_MS = 1_000;

/**
 * How long the faster cadence applies, set well past the observed 21 s worst
 * case so the window has headroom rather than sitting at its edge.
 */
export const STARTUP_HEARTBEAT_WINDOW_MS = 30_000;

/**
 * How a session's uptime is labelled for reporting: ordered upper bounds paired
 * with the label a session under each gets, with UPTIME_BUCKET_OVERFLOW past the
 * last. Buckets exist because a raw millisecond count cannot be charted, so
 * "did crashes move earlier in this build" would mean opening reports one at a
 * time. The bounds are fine early and coarse late because that is where the
 * evidence is, and it matches the heartbeat's own resolution either side of the
 * startup window.
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
 * A dirty record whose last heartbeat is this recent classifies as a crash: iOS
 * auto-reloads a killed foreground tab within seconds, so a short gap means the
 * OS killed and relaunched the page. A longer one is "unclean", since nothing
 * points specifically at an OS-level kill.
 */
export const CRASH_RELAUNCH_WINDOW_MS = 60_000;
