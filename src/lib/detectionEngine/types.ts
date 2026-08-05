import type { HudModel, Size } from "@/lib/detection";
import type { Track } from "@/lib/detectionTracker";
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
 * MIN_FRAME_INTERVAL_MS floor ("floor", fast devices), the proportional rest
 * ("rest", devices whose round trip is long enough that resting it exceeds the
 * remainder of the floor), or the MAX_FRAME_INTERVAL_MS ceiling ("capped", the
 * slowest devices, where the ramped rest would space scans further apart than
 * the detector can stay useful at).
 */
export type PacingRule = "floor" | "rest" | "capped";

/** The delay before the next capture, and which rule produced it. */
export type PacingDecision = {
  delayMs: number;
  rule: PacingRule;
};

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
  /**
   * Consecutive frame captures that failed since the last successful one.
   * The pump retries a failed capture forever (the expected cause, a video
   * element with no frame data yet, resolves itself moments later), so a
   * value that keeps climbing is the one visible sign the pump is spinning
   * on a video that never delivers.
   */
  captureFailures: number;
  /** Idle delay scheduled after the last result before the next capture. */
  pacingDelayMs: number;
  /** Which pacing rule produced pacingDelayMs. */
  pacingRule: PacingRule;
  /** Crop factor the frame was scanned at (ZOOM_OFF or ZOOM_2X). */
  zoom: number;
  /**
   * Largest per-tile luma shift the scene-change gate measured on the last
   * frame, whether it skipped or scanned. The number the threshold is tuned
   * against: point the camera at something still to read the noise floor, wave
   * a hand through the frame to read what real movement produces, and the
   * threshold belongs between them.
   */
  sceneDelta: number;
  /**
   * Inferences the gate has skipped since the last one it let through. Climbs
   * while the view is still and resets the moment something moves, so it reads
   * as how long the detector has been coasting. Bounded by the forced rescan,
   * which is what stops a threshold set too high from reading as a healthy
   * scanning session while the model has not run in minutes.
   */
  scanSkips: number;
  /** Scans since the engine activated that the model actually ran. */
  scansTotal: number;
  /** Scans since the engine activated that the gate answered without it. */
  skipsTotal: number;
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
  /**
   * The coasted tracker output with stable per-object ids, what the scene
   * view places (`detections` above stays the raw per-frame model output the
   * detection view draws).
   */
  tracks: Track[];
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
  /**
   * performance.now() when the pump last completed a scan, whether the model
   * ran or the scene-change gate answered the frame without it. The liveness
   * signal the radar sweep runs on: `scan.at` above only moves when the model
   * runs, so a gated session parked at a light would stop a sweep keyed on it
   * for up to SCENE_GATE_MAX_SKIP_MS while the detector is perfectly healthy.
   * Undefined until the first scan of a page load completes.
   */
  scanCompletedAt: number | undefined;
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
  /**
   * Let the worker skip inference on a frame that has not changed since the
   * one it last scanned; false is the debug-only escape hatch that makes every
   * frame a forced scan, which is what the gate's cost and benefit are measured
   * against on a device.
   */
  sceneGate: boolean;
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
   * Let the worker fetch the weights, for an engine built with the download
   * held back (`deferModelLoad`). Idempotent, and a no-op on an engine that was
   * never holding them: the gate only ever opens.
   */
  allowModelLoad: () => void;
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
