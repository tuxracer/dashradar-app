import type { DebugSnapshot } from "./types";

/** Retry delay when the video element has no frame data yet. */
export const FRAME_RETRY_MS = 100;

/**
 * Minimum interval between frame captures (~8 Hz). Without a floor the pump
 * sends the next frame the instant a result returns, so detection runs at
 * whatever rate the device manages: fast WebGPU phones end up running
 * inference back-to-back, pegging the GPU continuously and thermal-throttling
 * a dash-mounted phone. ~8 Hz is plenty for spotting vehicles, and the
 * coasting tracker plus motion stabilization cover the gaps between results.
 * Devices whose inference already takes longer than this are unaffected.
 */
export const MIN_FRAME_INTERVAL_MS = 125;

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
  shownCount: 0,
  overheadMs: 0,
};

/**
 * How long to wait for the service worker to control the page before starting
 * the worker's model download anyway. On a first visit the model fetch would
 * otherwise race ahead of Workbox taking control and bypass its runtime cache;
 * this bounds that wait so startup never stalls if control never arrives.
 */
export const SW_CONTROL_TIMEOUT_MS = 3_000;
