/**
 * Longest platform-supplied cause string sent with an `error` analytics event.
 * A GPUDevice lost message is written by the browser, not by us, so it has no
 * length any consumer can count on; this keeps one verbose driver string from
 * dominating an event property while leaving room for the part that identifies
 * the failure, which always comes first.
 */
export const ERROR_DETAIL_MAX_LENGTH = 200;
