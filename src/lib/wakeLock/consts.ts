/** `wake_lock` outcome tag for a lock the platform handed over. */
export const WAKE_LOCK_SUCCEEDED_OUTCOME = "succeeded";

/** `wake_lock` outcome tag for a lock the platform never handed over. */
export const WAKE_LOCK_FAILED_OUTCOME = "failed";

/**
 * `wake_lock` failure reason for a platform with no Wake Lock API at all
 * (pre-16.4 iOS, an insecure context). Distinct from a rejection name, because
 * it is not a refusal: the lock was never offered, so every session on that
 * device scans with a screen free to sleep.
 */
export const WAKE_LOCK_UNSUPPORTED_REASON = "unsupported";

/** `wake_lock` failure reason for a rejection that carried no error name. */
export const WAKE_LOCK_UNKNOWN_REASON = "unknown";

/**
 * `wake_lock` source tag for a lock won by the retry that rides a user gesture,
 * after the first request had already been refused and reported. It is what
 * separates a session that recovered from one that scanned with the screen free
 * to sleep, which the refusal count alone cannot say once a retry exists.
 */
export const WAKE_LOCK_GESTURE_SOURCE = "gesture";
