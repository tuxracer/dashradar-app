/** `wake_lock` outcome tag for a lock the platform handed over. */
export const WAKE_LOCK_SUCCEEDED_OUTCOME = "succeeded";

/** `wake_lock` outcome tag for a lock the platform never handed over. */
export const WAKE_LOCK_FAILED_OUTCOME = "failed";

/**
 * `wake_lock` failure reason for a platform with no Wake Lock API. Distinct from
 * a rejection name, because it is not a refusal: nothing was ever offered.
 */
export const WAKE_LOCK_UNSUPPORTED_REASON = "unsupported";

/** `wake_lock` failure reason for a rejection that carried no error name. */
export const WAKE_LOCK_UNKNOWN_REASON = "unknown";

/**
 * `wake_lock` source tag for a lock won by the gesture retry after a refusal was
 * already reported. Separates a recovered session from one that scanned with the
 * screen free to sleep, which the refusal count alone cannot say.
 */
export const WAKE_LOCK_GESTURE_SOURCE = "gesture";
