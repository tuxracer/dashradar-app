/** sessionStorage key holding the rolling per-scan timing history. */
export const TIMING_HISTORY_STORAGE_KEY = "dashradar:timings";

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
export const TIMING_ANALYTICS_STORAGE_KEY = "dashradar:timingsReported";
