/**
 * Longest platform-supplied cause string sent with an `error` analytics event.
 * A GPUDevice lost message is written by the browser, not by us, so it has no
 * length any consumer can count on; this keeps one verbose driver string from
 * dominating an event property while leaving room for the part that identifies
 * the failure, which always comes first.
 */
export const ERROR_DETAIL_MAX_LENGTH = 200;

/**
 * Bucket width the reported first-scan timings are rounded to, in
 * milliseconds. Half a second is coarse enough that ordinary frame-to-frame
 * jitter collapses into one value, so a reading means "about this fast"
 * rather than carrying noise nobody can act on.
 */
export const TIMING_BUCKET_MS = 500;
