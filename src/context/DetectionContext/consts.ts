import type { DebugSnapshot } from "./types";

/** Retry delay when the video element has no frame data yet. */
export const FRAME_RETRY_MS = 100;

/**
 * Minimum interval between frame captures: detection runs at most once per
 * second. Without a floor the pump sends the next frame the instant a result
 * returns, so detection runs at whatever rate the device manages: fast WebGPU
 * phones end up running inference back-to-back, pegging the GPU continuously
 * and thermal-throttling a dash-mounted phone. A once-per-second sweep is
 * enough for spotting police vehicles ahead, and the coasting tracker plus
 * motion stabilization keep the HUD steady between results; anything faster
 * mostly spends battery and heat. Devices whose adaptive rest (see
 * PACING_REST_RATIO below) already spaces captures wider than this are
 * unaffected.
 */
export const MIN_FRAME_INTERVAL_MS = 1_000;

/**
 * Fraction of a result's round-trip time the pump idles before starting the
 * next capture. The absolute floor above only paces devices faster than it;
 * a device whose inference takes longer than the floor (over a second on some
 * phones) would otherwise run the GPU back-to-back with zero idle, the worst
 * case for heat and battery on a dash-mounted phone, and sustained thermal
 * throttling then makes inference slower still. Resting half of each round
 * trip caps the inference duty cycle at roughly two thirds, trading a lower
 * detection rate (which was already low on such devices) for guaranteed
 * cool-down time. On fast devices the absolute floor dominates and this ratio
 * has no effect.
 */
export const PACING_REST_RATIO = 0.5;

/** Rolling window of result timestamps used for the FPS readout. */
export const FPS_SAMPLE_SIZE = 10;

/**
 * Debounce window for the anonymous `police_detected` analytics event. The
 * event fires only on the leading edge of a sighting: once reported, further
 * detections are treated as the same encounter and suppressed until police
 * have been absent for at least this long, so tailing a car continuously (a
 * detection roughly once a second) collapses into one event instead of a
 * flood. A sighting after this much absence counts as a fresh encounter.
 */
export const POLICE_EVENT_DEBOUNCE_MS = 30_000;

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
  pacingDelayMs: 0,
  pacingRule: "floor",
};

/**
 * How long to wait for the service worker to control the page before starting
 * the worker's model download anyway. On a first visit the model fetch would
 * otherwise race ahead of Workbox taking control and bypass its runtime cache;
 * this bounds that wait so startup never stalls if control never arrives.
 */
export const SW_CONTROL_TIMEOUT_MS = 3_000;
