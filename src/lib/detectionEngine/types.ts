import type { Observable } from "rxjs";
import type { ActiveView } from "@/lib/crashSentinel";
import type { HudModel, Size } from "@/lib/detection";
import type { DetectionClass } from "@/lib/detectionModels";
import type { Track } from "@/lib/detectionTracker";
import type { Contact } from "@/lib/processDetectionResult";
import type { Detection, IdentifiedDetection } from "@/types";
import type {
  BackendProbe,
  DetectionErrorCode,
  WorkerRequest,
  ZoomLevel,
} from "@/workers/detection/types";

export type DetectionStatus = "loading-model" | "ready" | "running" | "error";

export type ModelProgress = { loadedBytes: number; totalBytes: number };

/**
 * Which pacing rule set the delay before the next capture: the absolute floor
 * (fast devices), the proportional rest (slower ones), or the ceiling that stops
 * the ramp spacing scans further apart than the detector stays useful at.
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
  /** Round-trip time outside the worker's three stages: delivery and scheduling. */
  overheadMs: number;
  /**
   * Consecutive failed captures. The pump retries forever, so a value that keeps
   * climbing is the one visible sign it is spinning on a video that never
   * delivers a frame.
   */
  captureFailures: number;
  /** Idle delay scheduled after the last result before the next capture. */
  pacingDelayMs: number;
  pacingRule: PacingRule;
  /** Crop factor the frame was scanned at (ZOOM_OFF or ZOOM_2X). */
  zoom: number;
  /**
   * Largest per-tile luma shift the gate measured on the last frame, skip or
   * scan. The number the threshold is tuned against: something still reads the
   * noise floor, a hand through the frame reads real movement, and the threshold
   * belongs between them.
   */
  sceneDelta: number;
  /**
   * Inferences skipped since the last one the gate let through, so it reads as
   * how long the detector has been coasting. Bounded by the forced rescan.
   */
  scanSkips: number;
  /** Scans since the engine activated that the model actually ran. */
  scansTotal: number;
  /** Scans since the engine activated that the gate answered without it. */
  skipsTotal: number;
};

/** One completed scan's detections before identity: what the model reported,
 * validated and confidence-filtered, stamped with the result's arrival time. */
export type RawDetections = {
  detections: Detection[];
  /** performance.now() when the result arrived. */
  at: number;
};

/**
 * A rawDetections$ scan after identity: the same detections, each carrying the
 * stable id of the object it re-detects, plus the coasted track set those ids
 * live in. Data inferred about a detection later belongs here, not on the raw
 * stream.
 */
export type IdentifiedDetections = {
  detections: IdentifiedDetection[];
  tracks: Track[];
  /** performance.now() when the result arrived. */
  at: number;
};

/**
 * One completed scan. The detections are the frame's own, before the coasting
 * tracker, so a box on screen means the model saw it. The geometry travels with
 * them because the boxes must map against the frame that produced them, not
 * whatever the video element measures a second later after a rotation.
 */
export type ScanResult = {
  detections: IdentifiedDetection[];
  /** The coasted tracker output with stable ids, what the scene view places. */
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
  /**
   * What the running checkpoint looks for, as its own file named it on load,
   * which is the only place those words exist. Undefined until ready, and
   * afterwards for a file that names nothing.
   */
  loadedClasses: readonly DetectionClass[] | undefined;
  /** True only while the weights stream over the network (never for cache). */
  downloadingModel: boolean;
  modelProgress: ModelProgress;
  hud: HudModel | undefined;
  /** The most recent scan's raw per-frame detections; never cleared. */
  scan: ScanResult | undefined;
  error: DetectionErrorCode | undefined;
  /**
   * Latest cutout with its score, signal, and direction. Left untouched by
   * detection-free frames, so the card lingers through the meter's decay tail.
   */
  contact: Contact | undefined;
};

/**
 * The world state the owner pushes in. The first three are what the running
 * state derives from, with no imperative pause or resume; the last is carried
 * rather than acted on.
 */
export type EngineInputs = {
  /** The video element frames are captured from; undefined detaches it. */
  video: HTMLVideoElement | undefined;
  /** Whether the page is visible (document.visibilityState). */
  visible: boolean;
  settingsOpen: boolean;
  /**
   * Which view is on screen. Held only to stamp onto the crash heartbeat, since
   * what was on screen when a session died is the one thing no later launch can
   * reconstruct.
   */
  activeView: ActiveView;
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
   * Let the worker skip a frame that has not changed since the one it last
   * scanned; false forces every frame, which is what the gate is measured
   * against on a device.
   */
  sceneGate: boolean;
  /** Crop factor to capture at (ZOOM_OFF or ZOOM_2X). */
  zoom: ZoomLevel;
  /** Minimum detection confidence for decode and enrichment. */
  confidenceThreshold: number;
  /** Mirror the session log to the console, for tethered Inspector sessions. */
  consoleDiagnostics: boolean;
};

/**
 * The frame pump and worker lifecycle behind detection, framework-free. The
 * getSnapshot/subscribe pair is the useSyncExternalStore contract and equally
 * what a stream-based implementation exposes for free, so this interface
 * survives an internal rewrite.
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
  /** One emission per completed scan: the frame's detections before identity. */
  rawDetections$: Observable<RawDetections>;
  /** Derived from rawDetections$: the same scans with per-object identity. */
  identifiedDetections$: Observable<IdentifiedDetections>;
  /**
   * Let the worker fetch the weights, for an engine built with `deferModelLoad`.
   * Idempotent: the gate only ever opens.
   */
  allowModelLoad: () => void;
  /**
   * Spawn the worker and start loading the model. Resets published state, so a
   * deactivate/activate pair behaves like the fresh mount StrictMode makes it.
   */
  activate: () => void;
  /** Terminate the worker and release everything activate acquired. */
  deactivate: () => void;
};

/**
 * Structural worker type so tests can inject a fake. `postMessage` is
 * method-shorthand rather than an arrow-typed property because TypeScript checks
 * methods bivariantly, and the real DOM `Worker.postMessage` overload set only
 * satisfies the bivariant check.
 */
export type DetectionWorkerLike = {
  postMessage(message: WorkerRequest, transfer?: Transferable[]): void;
  terminate: () => void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};
