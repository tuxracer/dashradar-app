import { ZOOM_OFF } from "@/workers/detection/consts";
import type { DebugSnapshot, DetectionSnapshot } from "./types";

/** Retry delay when the video element has no frame data yet. */
export const FRAME_RETRY_MS = 100;

/**
 * Floor on the interval between frame captures. Without it a fast phone runs
 * inference back-to-back and cooks itself on the dash; once a second is enough
 * to spot a vehicle ahead, and the coasting tracker covers the gaps.
 */
export const MIN_FRAME_INTERVAL_MS = 1_000;

/**
 * Baseline fraction of a result's round trip the pump idles before the next
 * capture, holding the GPU busy at most half the time. Ratios rather than fixed
 * delays because a ratio of r caps the busy fraction at 1/(1+r) everywhere.
 */
export const PACING_REST_RATIO = 1;

/**
 * Where the rest ratio starts climbing, so a slowing device's duty cycle falls
 * instead of sitting flat. Half the floor is where the floor stops governing, so
 * every device fast enough for it is unaffected by the ramp.
 */
export const PACING_REST_RAMP_MS = MIN_FRAME_INTERVAL_MS / 2;

/** Ceiling on the ramped rest ratio, bounding the GPU duty cycle near 25%. */
export const PACING_REST_RATIO_MAX = 3;

/**
 * Hard ceiling on the delay between captures. The ramp trades detection rate
 * for heat, and unbounded that trade ends at a detector which misses most of
 * what the car drives past while still looking like it works.
 */
export const MAX_FRAME_INTERVAL_MS = 5_000;

/**
 * Longest the gate may go without the model running. A miscalibrated threshold
 * and a frozen camera both look exactly like a still scene from inside the app,
 * so the gate is not trusted to be its own backstop.
 */
export const SCENE_GATE_MAX_SKIP_MS = 10_000;

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
  captureFailures: 0,
  pacingDelayMs: 0,
  pacingRule: "floor",
  zoom: ZOOM_OFF,
  sceneDelta: 0,
  scanSkips: 0,
  scansTotal: 0,
  skipsTotal: 0,
};

/**
 * How long to wait for a service worker before downloading anyway. On a first
 * visit the fetch would otherwise race Workbox and bypass its runtime cache.
 */
export const SW_CONTROL_TIMEOUT_MS = 3_000;

/**
 * How long a worker may run before it is recycled at the next result boundary.
 * ORT arenas, GPU buffer pools, and the WASM heap all grow where JS can neither
 * see nor free them, and iOS kills the page at a hard cap, so this bounds the
 * growth over an hours-long session. Costs roughly one scan.
 */
export const WORKER_RECYCLE_AFTER_MS = 900_000;

/**
 * How long the pump waits for a posted frame's result before treating the
 * worker as wedged and recycling it. A hang fires neither a worker-error
 * message nor onerror, so without this the pump awaits a reply that never comes
 * and scanning stops silently for the rest of the drive.
 */
export const WORKER_REPLY_TIMEOUT_MS = 30_000;

/**
 * Longest a loading worker may go silent before it is recycled. An inactivity
 * bound, not a load budget: a healthy load posts at every stage down to each
 * chunk, so a slow network keeps resetting the clock while a wedged one says
 * nothing. The reply watchdog cannot cover this; no frame is posted yet.
 */
export const WORKER_LOAD_TIMEOUT_MS = 60_000;

/** Bytes in one mebibyte, for the console mirror's memory figures. */
export const BYTES_PER_MIB = 1_048_576;

/** Published state before the worker reports anything. */
export const INITIAL_SNAPSHOT: DetectionSnapshot = {
  status: "loading-model",
  backendProbe: undefined,
  loadedClasses: undefined,
  downloadingModel: false,
  modelProgress: { loadedBytes: 0, totalBytes: 0 },
  hud: undefined,
  scan: undefined,
  error: undefined,
  contact: undefined,
};
