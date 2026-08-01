/**
 * Bound on each network-facing step of the launch update check (looking up
 * the registration, then fetching the service worker script). The check runs
 * concurrently with the model load, so it only delays camera startup when the
 * fetch hangs, and this keeps that delay short.
 */
export const UPDATE_CHECK_TIMEOUT_MS = 5_000;

/**
 * How long to keep holding the camera once an update has been found and is
 * installing. The expected exit is the auto-update reload; this bound covers
 * an install that drags on a slow network, where giving up degrades to the
 * old prompt-then-reload behavior instead of a stalled startup.
 */
export const UPDATE_PENDING_TIMEOUT_MS = 20_000;
