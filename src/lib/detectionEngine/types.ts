import type { HudModel, Size } from "@/lib/detection";
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

/**
 * Which pacing rule set the delay before the next capture: the absolute
 * MIN_FRAME_INTERVAL_MS floor ("floor", fast devices) or the proportional
 * PACING_REST_RATIO rest ("rest", devices whose round trip is long enough
 * that resting all of it exceeds the remainder of the floor).
 */
export type PacingRule = "floor" | "rest";

/** Per-frame diagnostics surfaced when the debug overlay is enabled. */
export type DebugSnapshot = {
  /** Time to capture the video frame into an ImageBitmap (engine-side). */
  captureMs: number;
  preprocessMs: number;
  inferenceMs: number;
  decodeMs: number;
  /** Wall time from posting a frame to receiving its result (engine-side). */
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

/**
 * Everything the engine publishes for the UI, replaced wholesale on change so
 * subscribers can compare by reference (the useSyncExternalStore contract).
 */
export type DetectionSnapshot = {
  status: DetectionStatus;
  /** How the detector's backend came up; undefined until the session builds. */
  backendProbe: BackendProbe | undefined;
  /** True only while the weights stream over the network (never for cache). */
  downloadingModel: boolean;
  modelProgress: ModelProgress;
  hud: HudModel | undefined;
  /** The most recent scan's raw per-frame detections; never cleared. */
  scan: ScanResult | undefined;
  error: DetectionErrorCode | undefined;
  /**
   * Latest cutout with its score, remapped signal, and direction. Replaced
   * when a new crop arrives; left untouched by detection-free frames so the
   * contact card lingers through the meter's decay tail. Cleared on worker
   * errors and deactivation.
   */
  contact: Contact | undefined;
};

/**
 * The world state the engine derives its running state from. The pump runs
 * exactly while a video source is attached, the page is visible, and the
 * settings panel is closed; there is no imperative pause or resume.
 */
export type EngineInputs = {
  /** The video element frames are captured from; undefined detaches it. */
  video: HTMLVideoElement | undefined;
  /** Whether the page is visible (document.visibilityState). */
  visible: boolean;
  /** Whether the full-screen settings panel is open. */
  settingsOpen: boolean;
};

/**
 * The already-gated effective settings the engine scans with, pushed in by
 * the owner whenever they change and read per capture.
 */
export type EngineSettings = {
  /** Ask the worker for the top detection's cutout (the contact card). */
  includeContact: boolean;
  /** Apply the pacing floor and rest; false is the debug-only escape hatch. */
  throttled: boolean;
  /** Crop factor to capture at (ZOOM_OFF or ZOOM_2X). */
  zoom: ZoomLevel;
  /** Minimum detection confidence for decode and enrichment. */
  confidenceThreshold: number;
};

/**
 * The frame pump and worker lifecycle behind detection, framework-free. The
 * owner activates it, pushes inputs and settings, and reads snapshots; the
 * getSnapshot/subscribe pair is the useSyncExternalStore contract, and is
 * equally the shape a stream-based implementation exposes for free, so the
 * interface survives an internal rewrite.
 */
export type DetectionEngine = {
  /** Current published state; a stable reference until something changes. */
  getSnapshot: () => DetectionSnapshot;
  /** Register for snapshot changes; returns the unsubscribe. */
  subscribe: (onChange: () => void) => () => void;
  /** Merge new world state and re-derive whether the pump runs. */
  setInputs: (inputs: Partial<EngineInputs>) => void;
  /** Replace the effective settings the next capture scans with. */
  updateSettings: (settings: EngineSettings) => void;
  /** Latest per-frame diagnostics, read on demand (never published). */
  getDebugSnapshot: () => DebugSnapshot;
  /**
   * Spawn the worker and start loading the model. Resets published state, so
   * a deactivate/activate pair behaves like a fresh mount (which is what
   * StrictMode's double-invoked effects do to the owner).
   */
  activate: () => void;
  /** Terminate the worker and release everything activate acquired. */
  deactivate: () => void;
};

/**
 * Structural worker type so tests can inject a fake.
 *
 * `postMessage` uses method-shorthand syntax (not an arrow-typed property)
 * so a real `new Worker(...)` return value structurally satisfies this type:
 * TypeScript checks method signatures bivariantly but checks property
 * function types contravariantly, and the real DOM `Worker.postMessage`
 * overload set only satisfies the bivariant check.
 */
export type DetectionWorkerLike = {
  postMessage(message: WorkerRequest, transfer?: Transferable[]): void;
  terminate: () => void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};
