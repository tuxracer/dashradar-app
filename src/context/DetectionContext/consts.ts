/**
 * The pump's tunables live with the engine (src/lib/detectionEngine); these
 * re-exports keep the context module the one import consumers need.
 */
export {
  FRAME_RETRY_MS,
  INITIAL_DEBUG,
  MIN_FRAME_INTERVAL_MS,
  PACING_REST_RATIO,
  SW_CONTROL_TIMEOUT_MS,
  WORKER_RECYCLE_AFTER_MS,
} from "@/lib/detectionEngine";
