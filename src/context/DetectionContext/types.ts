import type { HudModel } from "@/lib/detection";
import type { MotionPermission, YawPitch } from "@/lib/motionSensor";
import type { ContactDirection } from "@/lib/radarSignal";
import type { NormalizedBox } from "@/types";
import type {
  BackendProbe,
  DetectionBackend,
  DetectionErrorCode,
  WorkerRequest,
} from "@/workers/detection/types";

export type DetectionStatus = "loading-model" | "ready" | "running" | "error";

/**
 * Result of probing WebGPU on the main thread. Complements the worker's
 * `BackendProbe`: comparing the two tells a device with no WebGPU anywhere
 * ("no-adapter" here as well) apart from a worker-only limitation ("adapter"
 * here but the worker still could not acquire one).
 */
export type MainThreadWebGpu =
  | "unsupported"
  | "no-adapter"
  | "adapter"
  | "error";

export type ModelProgress = { loadedBytes: number; totalBytes: number };

/** Latest detection cutout: the evidence radar detector mode renders. */
export type Contact = {
  /** Cutout ImageBitmap of the detection, from the exact inference frame. */
  image: ImageBitmap;
  /** Raw model score of the cropped detection. */
  score: number;
  /** Score remapped onto the meter's signal band (signalFromScore); the same
   * semantic as the dial readout so the two can never disagree. */
  signal: number;
  box: NormalizedBox;
  direction: ContactDirection;
  /** performance.now() when the result carrying this crop arrived. */
  at: number;
};

/**
 * Which pacing rule set the delay before the next capture: the absolute
 * MIN_FRAME_INTERVAL_MS floor ("floor", fast devices) or the proportional
 * PACING_REST_RATIO rest ("rest", devices whose round trip is long enough
 * that resting half of it exceeds the remainder of the floor).
 */
export type PacingRule = "floor" | "rest";

/** Per-frame diagnostics surfaced when the debug overlay is enabled. */
export type DebugSnapshot = {
  /** Time to capture the video frame into an ImageBitmap (context-side). */
  captureMs: number;
  preprocessMs: number;
  inferenceMs: number;
  decodeMs: number;
  /** Wall time from posting a frame to receiving its result (context-side). */
  roundTripMs: number;
  /** Detections decoded by the worker before the road-class/threshold filter. */
  rawCount: number;
  /** Detections remaining after toRoadDetections filtering. */
  filteredCount: number;
  /** Detections after the coasting tracker (what the HUD renders). */
  shownCount: number;
  /**
   * Time inside the round trip not spent in the worker's three stages:
   * postMessage delivery each way plus scheduling. Isolates worker-boundary
   * cost from model compute.
   */
  overheadMs: number;
  /** Idle delay scheduled after the last result before the next capture. */
  pacingDelayMs: number;
  /** Which pacing rule produced pacingDelayMs. */
  pacingRule: PacingRule;
};

export type DetectionContextValue = {
  status: DetectionStatus;
  backend: DetectionBackend | undefined;
  /**
   * WebGPU backend probe result, reported once at load. Undefined until the
   * worker finishes probing. Surfaced in the debug overlay to explain a CPU
   * fallback on a device whose main thread reports WebGPU support.
   */
  backendProbe: BackendProbe | undefined;
  /**
   * WebGPU adapter availability on the main thread, probed once at startup.
   * Undefined until the probe resolves. Read against `backendProbe` in the
   * debug overlay to locate where WebGPU acquisition fails.
   */
  mainThreadWebGpu: MainThreadWebGpu | undefined;
  /**
   * True only while the model weights are being downloaded over the network.
   * False when the weights load from cache, so the UI can suppress the
   * download-progress screen for the fast cache path.
   */
  downloadingModel: boolean;
  modelProgress: ModelProgress;
  hud: HudModel | undefined;
  /**
   * Rolling detection-result rate. Held in a ref and read on demand (the
   * debug overlay's readout tick, the settings panel's poll while open) so
   * per-result updates don't re-render the React tree.
   */
  getFps: () => number;
  /**
   * Latest per-frame diagnostics. Updated on every result but held in a ref
   * and read on demand, so results don't re-render the app while the debug
   * overlay is hidden and toggling it on still shows current numbers.
   */
  getDebugSnapshot: () => DebugSnapshot;
  error: DetectionErrorCode | undefined;
  /**
   * Latest detection cutout with its score, remapped signal, and direction.
   * Replaced when a new crop arrives; left untouched by detection-free frames
   * so radar detector mode's contact card lingers through the meter's decay
   * tail. Cleared on worker errors and teardown.
   */
  contact: Contact | undefined;
  start: (video: HTMLVideoElement) => void;
  stop: () => void;
  /** Cumulative yaw/pitch (radians) the camera has rotated since the currently
   * displayed detection was captured. Zero when motion is unavailable. Read per
   * animation frame by the HUD overlay to offset stale boxes. */
  getMotionDelta: () => YawPitch;
  /** Motion-sensor permission state; drives the iOS tap-to-start gate. */
  motionPermission: MotionPermission;
  /** Requests iOS motion permission from a user gesture; no-op elsewhere. */
  requestMotionPermission: () => Promise<void>;
};

/**
 * Structural worker type so tests can inject a fake.
 *
 * `postMessage` uses method-shorthand syntax (not an arrow-typed property)
 * so `createDetectionWorker`'s `new Worker(...)` return value structurally
 * satisfies this type: TypeScript checks method signatures bivariantly but
 * checks property function types contravariantly, and the real DOM
 * `Worker.postMessage` overload set only satisfies the bivariant check.
 */
export type DetectionWorkerLike = {
  postMessage(message: WorkerRequest, transfer?: Transferable[]): void;
  terminate: () => void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};
