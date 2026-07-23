import type { HudModel } from "@/lib/detection";
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

/**
 * Which detector tripped a camera-stall recovery, reported on the `camera_stall`
 * analytics event: `frozen` is the streak of byte-identical frames (a frozen or
 * black feed), `watchdog` is no detection result arriving within the watchdog
 * window (the feed fully stalled, so no result comes back at all), `obscured`
 * is a streak of frames with no bright pixels anywhere (a physically covered
 * lens).
 */
export type CameraStallReason = "frozen" | "watchdog" | "obscured";

/**
 * Latest cutout the radar detector mode renders on its contact card. Usually a
 * detection crop with its score, signal, box, and direction. In debug mode a
 * scan with no detection instead produces a bare frame preview (image and
 * frame only): the detection-only fields below are absent for it.
 */
export type Contact = {
  /**
   * The card image: a cutout of the detection, or, for a debug frame preview,
   * a downscaled thumbnail of the whole inference frame.
   */
  image: ImageBitmap;
  /**
   * Full inference frame the image was taken from, JPEG-encoded by the worker.
   * Present only when the frame was captured with the debug setting on; the
   * contact card's SAVE button downloads it for training data.
   */
  frame?: Blob;
  /** Raw model score of the cropped detection. Absent on a frame preview. */
  score?: number;
  /** Score remapped onto the meter's signal band (signalFromScore); the same
   * semantic as the dial readout so the two can never disagree. Absent on a
   * frame preview. */
  signal?: number;
  /** Cropped detection's box. Absent on a frame preview. */
  box?: NormalizedBox;
  /** Cropped detection's heading. Absent on a frame preview. */
  direction?: ContactDirection;
  /** performance.now() when the result carrying this image arrived. */
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
   * Latest cutout with its score, remapped signal, and direction. Replaced
   * when a new crop arrives; left untouched by detection-free frames so radar
   * detector mode's contact card lingers through the meter's decay tail. In
   * debug mode a detection-free scan instead replaces it with a bare frame
   * preview, so the card shows what every scan saw. Cleared on worker errors
   * and teardown.
   */
  contact: Contact | undefined;
  /** True while the camera feed is being re-acquired after a detected stall. */
  recovering: boolean;
  /**
   * True once automatic camera recovery has exhausted its remount attempts on a
   * frozen or black feed. Terminal: the pump is stopped and the app shows the
   * CAMERA_STALLED alert asking the driver to clear the lens and reload. Only a
   * reload clears it.
   */
  cameraStalled: boolean;
  /**
   * Increments once per camera recovery. App keys the CameraView element on
   * it, so a bump remounts the camera and re-runs getUserMedia.
   */
  cameraEpoch: number;
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
