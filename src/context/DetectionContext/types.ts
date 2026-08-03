import type { HudModel, Size } from "@/lib/detection";
import type { DetectionModel } from "@/lib/detectionModels";
import type { Contact } from "@/lib/processDetectionResult";
import type { Detection } from "@/types";
import type {
  BackendProbe,
  DetectionErrorCode,
  WorkerRequest,
  ZoomLevel,
} from "@/workers/detection/types";

export type DetectionStatus = "loading-model" | "ready" | "running" | "error";

export type ModelProgress = { loadedBytes: number; totalBytes: number };

export type { Contact } from "@/lib/processDetectionResult";

/**
 * Which pacing rule set the delay before the next capture: the absolute
 * MIN_FRAME_INTERVAL_MS floor ("floor", fast devices) or the proportional
 * PACING_REST_RATIO rest ("rest", devices whose round trip is long enough
 * that resting all of it exceeds the remainder of the floor).
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
  /** Detections decoded by the worker before class enrichment and the confidence filter. */
  rawCount: number;
  /** Detections remaining after enrichDetections. */
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
  /** Crop factor the frame was scanned at (ZOOM_OFF or ZOOM_2X). */
  zoom: number;
};

/**
 * One completed scan as the detection view draws it: the frame's own
 * detections after class enrichment and the confidence filter, before the
 * coasting tracker, so a box on screen means the model saw it on that frame
 * rather than that a track is being held through a miss. The frame geometry
 * and crop factor travel with them, because the boxes must be mapped against
 * the frame that produced them and not against whatever the video element
 * measures a second later, after a rotation.
 */
export type ScanResult = {
  detections: Detection[];
  /** Intrinsic size of the captured frame, in pixels. */
  frame: Size;
  /** Crop factor the frame was captured at. */
  zoom: ZoomLevel;
  /** performance.now() when the result arrived. */
  at: number;
};

export type DetectionContextValue = {
  status: DetectionStatus;
  /**
   * How the detector's backend came up, reported once per worker. Undefined
   * until the session is built. Surfaced in the debug overlay.
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
  /**
   * The most recent scan's raw per-frame detections, for the detection view's
   * bounding boxes. Undefined until the first result; never cleared.
   */
  scan: ScanResult | undefined;
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
   * detector mode's contact card lingers through the meter's decay tail.
   * Cleared on worker errors and teardown.
   */
  contact: Contact | undefined;
  /**
   * The model this session is running. Pinned at mount, so it answers "what is
   * detecting right now", which is not necessarily what is selected: a change
   * made on the model screen applies on the reload that screen performs.
   */
  activeModel: DetectionModel;
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
