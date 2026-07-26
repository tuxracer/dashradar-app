/** sessionStorage key holding the rolling per-scan timing history. */
export const TIMING_HISTORY_STORAGE_KEY = "dashradar:timings";

/**
 * How many scans each series keeps. The window is short on purpose: this is
 * for reading how the last stretch of a drive paced, not for building a
 * session-long log, and a short window keeps the write cheap.
 */
export const TIMING_HISTORY_LIMIT = 10;

/**
 * Bucket width the samples are rounded to, in milliseconds. Half a second is
 * coarse enough that ordinary frame-to-frame jitter collapses into one value,
 * so a series reads as a pacing trend rather than noise.
 */
export const TIMING_BUCKET_MS = 500;
