/**
 * Longest platform-supplied cause string sent with an `error` event. The browser
 * writes these, so they have no length any consumer can count on; the part that
 * identifies the failure always comes first.
 */
export const ERROR_DETAIL_MAX_LENGTH = 200;

/**
 * Bucket width the reported first-scan timings are rounded to, in
 * milliseconds. Half a second is coarse enough that ordinary frame-to-frame
 * jitter collapses into one value, so a reading means "about this fast"
 * rather than carrying noise nobody can act on.
 */
export const TIMING_BUCKET_MS = 500;
