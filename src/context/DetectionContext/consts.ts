/**
 * The pump's tunables live with the engine (src/lib/detectionEngine); these
 * re-exports keep the context module the one import consumers need.
 */
export {
  FRAME_RETRY_MS,
  INITIAL_DEBUG,
  MAX_FRAME_INTERVAL_MS,
  MIN_FRAME_INTERVAL_MS,
  PACING_REST_RAMP_MS,
  PACING_REST_RATIO,
  PACING_REST_RATIO_MAX,
  SCENE_GATE_MAX_SKIP_MS,
  SW_CONTROL_TIMEOUT_MS,
  WORKER_RECYCLE_AFTER_MS,
  WORKER_REPLY_TIMEOUT_MS,
} from "@/lib/detectionEngine";
