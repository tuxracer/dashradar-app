import type { DebugSnapshot } from "./types";

/** Retry delay when the video element has no frame data yet. */
export const FRAME_RETRY_MS = 100;

/** Rolling window of result timestamps used for the FPS readout. */
export const FPS_SAMPLE_SIZE = 10;

/** Zeroed debug snapshot shown before the first detection result arrives. */
export const INITIAL_DEBUG: DebugSnapshot = {
  captureMs: 0,
  preprocessMs: 0,
  inferenceMs: 0,
  decodeMs: 0,
  roundTripMs: 0,
  rawCount: 0,
  filteredCount: 0,
  confirmedCount: 0,
  overheadMs: 0,
};

/**
 * How long to wait for the service worker to control the page before starting
 * the worker's model download anyway. On a first visit the model fetch would
 * otherwise race ahead of Workbox taking control and bypass its runtime cache;
 * this bounds that wait so startup never stalls if control never arrives.
 */
export const SW_CONTROL_TIMEOUT_MS = 3_000;
