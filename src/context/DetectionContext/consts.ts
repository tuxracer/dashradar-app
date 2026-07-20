/** Retry delay when the video element has no frame data yet. */
export const FRAME_RETRY_MS = 100;

/** Rolling window of result timestamps used for the FPS readout. */
export const FPS_SAMPLE_SIZE = 10;

/**
 * How long to wait for the service worker to control the page before starting
 * the worker's model download anyway. On a first visit the model fetch would
 * otherwise race ahead of Workbox taking control and bypass its runtime cache;
 * this bounds that wait so startup never stalls if control never arrives.
 */
export const SW_CONTROL_TIMEOUT_MS = 3_000;
