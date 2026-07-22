/** Filename prefix for saved detection frames. */
export const FRAME_FILE_PREFIX = "dashradar-frame";

/** File extension matching the worker's JPEG encoding of saved frames. */
export const FRAME_FILE_EXTENSION = "jpg";

/**
 * How long to wait before revoking a download's object URL. Safari resolves
 * blob-URL downloads asynchronously, so an immediate revoke can abort the
 * download; revoking after a generous delay keeps memory bounded without
 * racing the browser.
 */
export const REVOKE_DELAY_MS = 10_000;
