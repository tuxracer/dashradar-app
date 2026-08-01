/**
 * `wake_lock_failed` reason for a platform with no Wake Lock API at all
 * (pre-16.4 iOS, an insecure context). Distinct from a rejection name, because
 * it is not a refusal: the lock was never offered, so every session on that
 * device scans with a screen free to sleep.
 */
export const WAKE_LOCK_UNSUPPORTED_REASON = "unsupported";

/** `wake_lock_failed` reason for a rejection that carried no error name. */
export const WAKE_LOCK_UNKNOWN_REASON = "unknown";
