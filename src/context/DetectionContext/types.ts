import type { DebugSnapshot, DetectionSnapshot } from "@/lib/detectionEngine";
import type { DetectionModel } from "@/lib/detectionModels";

/**
 * The detection domain types live with the engine (src/lib/detectionEngine);
 * these re-exports keep the context module the one import consumers need.
 */
export type {
  DebugSnapshot,
  DetectionSnapshot,
  DetectionStatus,
  DetectionWorkerLike,
  ModelProgress,
  PacingRule,
  ScanResult,
} from "@/lib/detectionEngine";
export type { Contact } from "@/lib/processDetectionResult";
export type { Track } from "@/lib/detectionTracker";

/**
 * What useDetection() exposes: the engine's snapshot plus what only the React
 * layer knows. `contact` is additionally gated on the detection-image setting
 * here, so turning it off drops a card already on screen.
 */
export type DetectionContextValue = DetectionSnapshot & {
  /**
   * Latest per-frame diagnostics. Held by the engine and read on demand, so
   * results don't re-render the app while the debug overlay is hidden and
   * toggling it on still shows current numbers.
   */
  getDebugSnapshot: () => DebugSnapshot;
  /**
   * Release a download the provider was told to hold back
   * (`deferModelLoad`), and a no-op when it was not. Called by whatever screen
   * knows the bytes are now worth fetching, so the decision lives with the UI
   * rather than in the engine.
   */
  allowModelLoad: () => void;
  /**
   * The model this session is running. Pinned at mount, so it answers "what
   * is detecting right now", which is not necessarily what is selected: a
   * change made on the model screen applies on the reload that screen
   * performs.
   */
  activeModel: DetectionModel;
  /** Attach the camera's video element; detection runs while one is attached. */
  attachVideo: (video: HTMLVideoElement) => void;
  /** Detach the video element, stopping detection. */
  detachVideo: () => void;
};
