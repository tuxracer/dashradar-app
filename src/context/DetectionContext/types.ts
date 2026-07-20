import type { HudModel } from "@/lib/detection";
import type { MotionPermission, YawPitch } from "@/lib/motionSensor";
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
  /** Confirmed detections after the persistence gate (what the HUD renders). */
  confirmedCount: number;
  /**
   * Time inside the round trip not spent in the worker's three stages:
   * postMessage delivery each way plus scheduling. Isolates worker-boundary
   * cost from model compute.
   */
  overheadMs: number;
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
  fps: number;
  debug: DebugSnapshot;
  error: DetectionErrorCode | undefined;
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
