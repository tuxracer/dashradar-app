import type { DebugSnapshot } from "./types";

/** Retry delay when the video element has no frame data yet. */
export const FRAME_RETRY_MS = 100;

/**
 * Minimum interval between frame captures: detection runs at most once every
 * two seconds. Without a floor the pump sends the next frame the instant a
 * result returns, so detection runs at whatever rate the device manages: fast
 * WebGPU phones end up running inference back-to-back, pegging the GPU
 * continuously and thermal-throttling a dash-mounted phone (or draining the
 * battery hard enough to shut down). A once-every-two-seconds sweep is enough
 * for spotting police vehicles ahead, and the coasting tracker plus motion
 * stabilization keep the HUD steady between results; anything faster mostly
 * spends battery and heat. Devices whose adaptive rest (see PACING_REST_RATIO
 * below) already spaces captures wider than this are unaffected.
 */
export const MIN_FRAME_INTERVAL_MS = 2_000;

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
 * detection at most once every two seconds) collapses into one event instead
 * of a flood. A sighting after this much absence counts as a fresh encounter.
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
 * Consecutive byte-identical inference frames that mark a frozen or black
 * camera feed and trigger camera recovery. At the ~1 fps pacing floor this is
 * about five seconds of a dead feed. Conservative on purpose: a spurious
 * reconnect while driving is worse than a few seconds of delay before
 * recovering.
 */
export const STALE_FRAME_THRESHOLD = 5;

/**
 * Consecutive in-place camera recoveries that each re-stall before the feed
 * proves healthy, after which a full page reload is the last resort instead
 * of another remount. Reset once a recovery yields RECOVERY_HEALTHY_FRAMES
 * good frames.
 */
export const MAX_RECONNECT_ATTEMPTS = 3;

/**
 * Changing (non-identical) frames after a recovery that mark it successful
 * and reset the reconnect-attempt counter, so an isolated takeover long ago
 * does not push a later, unrelated stall straight to a reload.
 */
export const RECOVERY_HEALTHY_FRAMES = 5;

/**
 * Maximum time the pump may go without a detection result while it is live
 * before the camera is assumed fully stalled (requestVideoFrameCallback
 * stopped firing, so the pump is hung waiting for a new frame) and recovery
 * runs. Set well above the worst-case interval between two legitimate results
 * on a slow device: pacing rests PACING_REST_RATIO of each round trip and a
 * slow phone's inference round trip can be a few seconds, so real results can
 * legitimately be 6-8 seconds apart. It is also deliberately larger than the
 * crash-sentinel HEARTBEAT_INTERVAL_MS so a heartbeat-length gap never trips
 * the watchdog. A truly stalled feed never recovers, so a longer detection
 * latency here is a safe trade for not false-firing on a slow-but-alive device.
 */
export const WATCHDOG_MS = 15_000;
