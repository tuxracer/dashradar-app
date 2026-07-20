import type { HudModel } from "@/lib/detection";
import type {
  BackendProbe,
  DetectionBackend,
  DetectionErrorCode,
  WorkerRequest,
} from "@/workers/detection/types";

export type DetectionStatus = "loading-model" | "ready" | "running" | "error";

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
