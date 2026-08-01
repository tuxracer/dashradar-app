/** sessionStorage key holding the rolling per-scan timing history. */
export const TIMING_HISTORY_STORAGE_KEY = "timings";

/**
 * How many scans each series keeps, and so how many a session records before
 * its one timing report is due. The window is short on purpose: this is for
 * reading how the last stretch of a drive paced, not for building a
 * session-long log, a short window keeps the write cheap, and five scans is
 * already past the first-run costs (a cold session compile, a cold GPU) while
 * still being reached by even a short session.
 */
export const TIMING_HISTORY_LIMIT = 5;

/**
 * Bucket width the samples are rounded to, in milliseconds. Half a second is
 * coarse enough that ordinary frame-to-frame jitter collapses into one value,
 * so a series reads as a pacing trend rather than noise.
 */
export const TIMING_BUCKET_MS = 500;

/**
 * sessionStorage key marking that this session already reported its median
 * timings to analytics. Its presence is the whole record; the value is only
 * there to make the entry readable in devtools.
 */
export const TIMING_ANALYTICS_STORAGE_KEY = "timingsReported";

/** As above, for the late report. Separate key, separate one-shot. */
export const LATE_TIMING_ANALYTICS_STORAGE_KEY = "lateTimingsReported";

/**
 * Scanning time a session must accumulate before its second, late timing
 * report is due. The first report fires five scans in, deliberately the
 * coldest sample of the drive, which is exactly the wrong place to read the
 * constraint the app is built around: a phone clamped to a windshield in the
 * sun throttles as it heats, and nothing in the early median can show that.
 * Fifteen minutes is long enough for a dash-mounted phone to reach its steady
 * thermal state and short enough that an ordinary drive reaches it, so the two
 * reports read side by side as cold versus hot on the same device.
 */
export const LATE_TIMING_AFTER_MS = 900_000;
