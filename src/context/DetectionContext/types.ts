import type { AutoZoomLevel, AutoZoomState } from "@/lib/autoZoom";
import type { HudModel, Size } from "@/lib/detection";
import type { ContactDirection } from "@/lib/radarSignal";
import type { Detection, NormalizedBox } from "@/types";
import type {
  BackendProbe,
  DetectionErrorCode,
  WorkerRequest,
} from "@/workers/detection/types";

export type DetectionStatus = "loading-model" | "ready" | "running" | "error";

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
 * detection crop with its score, signal, box, and direction. With the frame
 * preview setting on, a scan with no detection instead produces a bare frame
 * preview (image and frame only): the detection-only fields below are absent
 * for it.
 */
export type Contact = {
  /**
   * The card image: a cutout of the detection, or, for a frame preview, a
   * downscaled thumbnail of the whole inference frame.
   */
  image: ImageBitmap;
  /**
   * The model's square input for this scan, JPEG-encoded by the worker.
   * Present only when the frame was captured with the frame-saving setting on;
   * the contact card's SAVE button downloads it for training data.
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
 * Most recent frame the auto-save developer option downloaded. Replaced on
 * every save (`at` is fresh each time, so a repeat save is a distinct value),
 * which is what lets the save toast re-show for a run of saved detections.
 */
export type SavedFrame = {
  /** Name the frame was downloaded under. */
  filename: string;
  /** performance.now() when the download fired. */
  at: number;
};

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
  /** Detections decoded by the worker before the road-class/threshold filter. */
  rawCount: number;
  /** Detections remaining after toRoadDetections filtering. */
  filteredCount: number;
  /** Detections after the coasting tracker (what the HUD renders). */
  shownCount: number;
  /**
   * Fraction of the last frame's subsample bright enough to rule out an
   * obscured lens (frameBrightFraction). Near zero means a dark or covered
   * feed; shown in the debug overlay to tune the obscured-lens threshold.
   */
  brightFraction: number;
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
  /**
   * Whether the auto zoom is holding its level because a detection is
   * present. Always false in the fixed zoom modes.
   */
  zoomLocked: boolean;
};

/**
 * One completed scan as the detection view draws it: the frame's own
 * detections after the road-class and confidence filter, before the coasting
 * tracker, so a box on screen means the model saw it on that frame rather than
 * that a track is being held through a miss. The frame geometry and crop
 * factor travel with them, because the boxes must be mapped against the frame
 * that produced them and not against whatever the video element measures a
 * second later, after a rotation or an auto-zoom step.
 */
export type ScanResult = {
  detections: Detection[];
  /** Intrinsic size of the captured frame, in pixels. */
  frame: Size;
  /** Crop factor the frame was captured at. */
  zoom: AutoZoomLevel;
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
   * bounding boxes. Undefined until the first result. Never cleared: the view
   * only renders while scanning, and the next scan replaces it a second later.
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
   * detector mode's contact card lingers through the meter's decay tail. With
   * the frame preview setting on, a detection-free scan instead replaces it
   * with a bare frame preview, so the card shows what every scan saw. Cleared
   * on worker errors and teardown.
   */
  contact: Contact | undefined;
  /**
   * Latest frame the auto-save developer option wrote to disk, for the save
   * toast. A download is otherwise invisible on a phone, so this is the only
   * confirmation a collection drive gets that saving is actually working.
   * Undefined until the first save of the session; never cleared, since the
   * toast times itself out.
   */
  savedFrame: SavedFrame | undefined;
  /**
   * The auto zoom machine's current state (crop factor and whether a present
   * detection is locking it), for the on-glass zoom indicator. Advances once
   * per scan while the zoom mode is auto; resets to 1x/unlocked on stop, so
   * it reads that way in the fixed modes too (where the indicator derives its
   * label from the mode alone).
   */
  autoZoom: AutoZoomState;
  /**
   * True once automatic camera recovery has exhausted its remount attempts on a
   * frozen or black feed. Terminal for the camera: the pump is stopped and the
   * app shows the CAMERA_STALLED alert asking the driver to clear the lens and
   * reload. Only a reload or clearCameraStall clears it.
   */
  cameraStalled: boolean;
  /**
   * Increments once per camera recovery. App keys the CameraView element on
   * it, so a bump remounts the camera and re-runs getUserMedia.
   */
  cameraEpoch: number;
  start: (video: HTMLVideoElement) => void;
  stop: () => void;
  /**
   * Swaps the detection feed to `file`, or back to the startup source with
   * null. Stops the pump first, so the view mounted for the new feed is the
   * one that starts it again.
   */
  swapVideoSource: (file: File | null) => void;
  /**
   * Forgets a camera stall. Returning to the camera after a clip has played
   * deserves a fresh attempt rather than the terminal screen a previous stall
   * left behind.
   */
  clearCameraStall: () => void;
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
