import { ZOOM_OFF } from "@/workers/detection/consts";
import type { DebugSnapshot, DetectionSnapshot } from "./types";

/** Retry delay when the video element has no frame data yet. */
export const FRAME_RETRY_MS = 100;

/**
 * Minimum interval between frame captures: detection runs at most once per
 * second. Without a floor the pump sends the next frame the instant a
 * result returns, so detection runs at whatever rate the device manages: fast
 * WebGPU phones end up running inference back-to-back, pegging the GPU
 * continuously and thermal-throttling a dash-mounted phone (or draining the
 * battery hard enough to shut down). A once-per-second sweep is enough
 * for spotting police vehicles ahead, and the coasting tracker plus motion
 * stabilization keep the HUD steady between results; anything faster mostly
 * spends battery and heat. Devices whose adaptive rest (see PACING_REST_RATIO
 * below) already spaces captures wider than this are unaffected.
 */
export const MIN_FRAME_INTERVAL_MS = 1_000;

/**
 * Baseline fraction of a result's round-trip time the pump idles before
 * starting the next capture. Resting a full round trip puts captures 2x the
 * round trip apart, so the GPU is idle at least half the time. The absolute
 * floor above only paces devices whose round trip is under half of it; a
 * device slower than that would otherwise run the GPU back-to-back with little
 * idle, the worst case for heat and battery on a dash-mounted phone.
 *
 * This ratio alone is not enough, which is what PACING_REST_RAMP_MS below
 * exists to fix. What heats a phone is the fraction of wall time the GPU spends
 * busy, not how many milliseconds of idle sit between runs, and a flat ratio
 * holds that fraction constant: at ratio 1 the duty cycle is round trip over
 * twice the round trip, or 50%, for every round trip past half the floor. A
 * phone that is already throttling gets more absolute cool-down but no smaller
 * share of busy time, so the pacing never actually backs off the load that
 * caused the throttling.
 */
export const PACING_REST_RATIO = 1;

/**
 * Round-trip time at which the rest ratio starts climbing above
 * PACING_REST_RATIO, rising in proportion to the round trip until
 * PACING_REST_RATIO_MAX. This is what makes the duty cycle fall as a device
 * slows down instead of sitting at a flat 50%: at twice this figure the pump
 * rests twice the round trip (33% busy), at three times it rests three (25%).
 *
 * Set to half MIN_FRAME_INTERVAL_MS on purpose. That is exactly where resting
 * the whole round trip stops leaving the floor in charge, so every device fast
 * enough for the floor to govern is paced precisely as it was before the ramp
 * existed and only devices already in the proportional regime see any change.
 */
export const PACING_REST_RAMP_MS = MIN_FRAME_INTERVAL_MS / 2;

/**
 * Ceiling on the ramped rest ratio, bounding the duty cycle at roughly 25%.
 * Past this the pacing has backed off as far as it usefully can, and letting
 * the ratio keep climbing would only push the gap between scans out further for
 * a diminishing thermal return.
 */
export const PACING_REST_RATIO_MAX = 3;

/**
 * Hard ceiling on the delay between captures, whatever the rest ratio asks
 * for. The ramp above trades detection rate for heat, and without a bound that
 * trade eventually reaches the outcome this project already rejected once: a
 * detector scanning so rarely that it misses most of what the car drives past
 * is worse than no detector, because it still looks like it is working. Five
 * seconds is the point where backing off further stops being worth having.
 *
 * A device slow enough to hit this cap is one where both failure modes are in
 * play at once and neither can be fully avoided; the cap picks staying useful.
 */
export const MAX_FRAME_INTERVAL_MS = 5_000;

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
};

/**
 * How long to wait for the service worker to control the page before starting
 * the worker's model download anyway. On a first visit the model fetch would
 * otherwise race ahead of Workbox taking control and bypass its runtime cache;
 * this bounds that wait so startup never stalls if control never arrives.
 */
export const SW_CONTROL_TIMEOUT_MS = 3_000;

/**
 * How long a detection worker may run before it is recycled (terminated and
 * recreated) at the next result boundary. onnxruntime-web and the browser GPU
 * stacks accumulate native memory over thousands of runs that JS cannot observe
 * or free: ORT arenas, GPU buffer pools, and the WASM heap all grow invisibly.
 * Recreating the worker resets all of that, turning unbounded growth into
 * bounded growth. iOS kills the whole page near a hard memory cap, so this is
 * the primary crash mitigation for the long scanning sessions this app is built
 * for (hours on a dash-mounted phone). The weights are cached, so a recycle
 * re-loads from CacheStorage without a network download or visible loading UI.
 */
export const WORKER_RECYCLE_AFTER_MS = 900_000;

/**
 * How long the pump waits for a posted frame's result before treating the
 * worker as hung and recycling it. A healthy WebGPU round trip measures around
 * half a second and even a heavily throttled phone stays within a few seconds,
 * so a reply this late means the worker is wedged (a stuck GPU queue, a
 * runtime deadlock) in a way that fires neither a worker-error message nor
 * onerror. Without the bound the pump would await the reply forever, and
 * scanning would silently stop for the rest of the drive; recycling gives it
 * a fresh worker within a bearable gap instead.
 */
export const WORKER_REPLY_TIMEOUT_MS = 30_000;

/** Published state before the worker reports anything. */
export const INITIAL_SNAPSHOT: DetectionSnapshot = {
  status: "loading-model",
  backendProbe: undefined,
  downloadingModel: false,
  modelProgress: { loadedBytes: 0, totalBytes: 0 },
  hud: undefined,
  scan: undefined,
  error: undefined,
  contact: undefined,
};
