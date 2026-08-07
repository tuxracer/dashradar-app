import { isBoolean, isNumber, isPlainObject, isString } from "remeda";
import { isDetectionClass, isDetectionModel } from "@/lib/detectionModels";
import type { DetectionClass, DetectionModel } from "@/lib/detectionModels";
import { isOnnxMetadata } from "@/lib/onnxMetadata";
import type { OnnxMetadata } from "@/lib/onnxMetadata";
import type { RawDetection } from "@/types";
import { isRawDetection } from "@/types";
import type { ZOOM_2X, ZOOM_OFF } from "./consts";

/**
 * WEBGPU_UNSUPPORTED comes from the GPU probe, before any weights are fetched,
 * on a device with no `navigator.gpu` in the worker scope, no adapter, or an
 * adapter without `shader-f16`. Terminal rather than a fallback, since the CPU
 * path was dropped for being too slow to be worth shipping.
 *
 * GPU_DEVICE_LOST is the device behind a loaded session being lost, which WebKit
 * can do by killing its GPU process while the page keeps running. Without it the
 * app notices a frame later as a generic INFERENCE_FAILED; naming the cause is
 * what separates a GPU-process death from an OS kill, which reports nothing at
 * all beyond the crash sentinel.
 */
export type DetectionErrorCode =
  | "WEBGPU_UNSUPPORTED"
  | "MODEL_LOAD_FAILED"
  | "INFERENCE_FAILED"
  | "GPU_DEVICE_LOST"
  | "WORKER_CRASHED";

const DETECTION_ERROR_CODES: readonly DetectionErrorCode[] = [
  "WEBGPU_UNSUPPORTED",
  "MODEL_LOAD_FAILED",
  "INFERENCE_FAILED",
  "GPU_DEVICE_LOST",
  "WORKER_CRASHED",
];

export const isDetectionErrorCode = (
  value: unknown,
): value is DetectionErrorCode => {
  return (
    isString(value) &&
    DETECTION_ERROR_CODES.includes(value as DetectionErrorCode)
  );
};

export class DetectionError extends Error {
  readonly code: DetectionErrorCode;

  constructor(code: DetectionErrorCode) {
    super(code);
    this.name = "DetectionError";
    this.code = code;
  }
}

export const isDetectionError = (error: unknown): error is DetectionError => {
  return error instanceof DetectionError;
};

/**
 * Bounded classification of a device loss, mirroring GPUDeviceLostReason. Kept
 * apart from `detail`'s free text because this travels into the crash sentinel's
 * log, which only ever ships bounded values.
 */
export type GpuDeviceLostReason = "unknown" | "destroyed";

const GPU_DEVICE_LOST_REASONS: readonly GpuDeviceLostReason[] = [
  "unknown",
  "destroyed",
];

export const isGpuDeviceLostReason = (
  value: unknown,
): value is GpuDeviceLostReason =>
  isString(value) &&
  GPU_DEVICE_LOST_REASONS.includes(value as GpuDeviceLostReason);

export type WorkerRequest =
  /**
   * Can this device run the detector? Sent as soon as the worker exists, ahead
   * of `load`, so an unsupported device is turned away before the camera ask and
   * before a byte of the model is fetched. Answered only on failure.
   */
  | { type: "probe" }
  /**
   * Build a session for this model entry, downloading its weights if they are
   * not cached. The entry travels on the message because a worker has no
   * localStorage to read the selection from; an omitted entry loads
   * DEFAULT_MODEL, keeping a recycle safe whatever storage does.
   */
  | { type: "load"; model?: DetectionModel }
  | {
      type: "detect";
      frame: ImageBitmap;
      /**
       * Whether to cut the top detection out of the frame. Defaults to true;
       * false when the contact card is off, so no image is produced.
       */
      includeCrop?: boolean;
      /** Crop factor for the square fed to the model; 1 is the full square. */
      zoom?: number;
      /**
       * Intrinsic size of the video frame `frame` was cut from, present only when
       * the sender already applied the crop and scaled to the model's input. The
       * worker then scales the bitmap straight on rather than cropping again, and
       * maps boxes through these dimensions so detections stay in full-frame
       * coordinates either way. Senders pre-crop only when no cutout is wanted,
       * the one consumer that needs the frame's original pixels.
       */
      source?: { width: number; height: number };
      /** Minimum confidence for this frame's decode, filtered inside the worker. */
      confidenceThreshold?: number;
      /**
       * Run inference whatever the scene-change gate makes of the frame. The
       * worker measures the movement, but the sender decides when skipping has
       * gone on too long, because only the sender knows when scanning last
       * produced a real answer and when a pause interrupted it.
       */
      forceScan?: boolean;
    };

/** Whether a value carries usable pixel dimensions for a captured frame. */
const isFrameSize = (
  value: unknown,
): value is { width: number; height: number } =>
  isPlainObject(value) &&
  isNumber(value.width) &&
  isNumber(value.height) &&
  value.width > 0 &&
  value.height > 0;

export const isWorkerRequest = (value: unknown): value is WorkerRequest => {
  if (!isPlainObject(value)) {
    return false;
  }
  if (value.type === "probe") {
    return true;
  }
  if (value.type === "load") {
    return value.model === undefined || isDetectionModel(value.model);
  }
  return (
    value.type === "detect" &&
    typeof ImageBitmap !== "undefined" &&
    value.frame instanceof ImageBitmap &&
    (value.includeCrop === undefined || isBoolean(value.includeCrop)) &&
    (value.zoom === undefined || isNumber(value.zoom)) &&
    (value.source === undefined || isFrameSize(value.source)) &&
    (value.confidenceThreshold === undefined ||
      isNumber(value.confidenceThreshold)) &&
    (value.forceScan === undefined || isBoolean(value.forceScan))
  );
};

export type ModelFileProgress = { file: string; loaded: number; total: number };

const isModelFileProgress = (value: unknown): value is ModelFileProgress => {
  return (
    isPlainObject(value) &&
    isString(value.file) &&
    isNumber(value.loaded) &&
    isNumber(value.total)
  );
};

/** Per-frame timing (milliseconds) reported alongside detections for debug. */
export type FrameTiming = {
  preprocessMs: number;
  inferenceMs: number;
  decodeMs: number;
};

const isFrameTiming = (value: unknown): value is FrameTiming => {
  return (
    isPlainObject(value) &&
    isNumber(value.preprocessMs) &&
    isNumber(value.inferenceMs) &&
    isNumber(value.decodeMs)
  );
};

/**
 * Cutout of the highest-scoring detection, cropped from the exact frame
 * inference ran on, which the main thread never sees.
 */
export type DetectionCrop = {
  image: ImageBitmap;
  /** Index into the message's detections array of the cropped detection. */
  detectionIndex: number;
};

const isDetectionCrop = (value: unknown): value is DetectionCrop => {
  return (
    isPlainObject(value) &&
    typeof ImageBitmap !== "undefined" &&
    value.image instanceof ImageBitmap &&
    isNumber(value.detectionIndex)
  );
};

/**
 * How the backend came up and what the weights say about themselves, reported
 * once per worker after `load`. The GPU probe's verdict is not here: a device
 * that fails it never reaches this message, so anything reading a probe is
 * already running on WebGPU.
 */
export type BackendProbe = {
  /** InferenceSession.create failure message for the WebGPU attempt, if any. */
  sessionError?: string;
  /**
   * Whether the session runs with graph capture. False covers both the flag
   * being off and the attempt failing; `graphCaptureError` distinguishes them.
   */
  graphCapture: boolean;
  /** Failure message from the graph-capture attempt when it fell back. */
  graphCaptureError?: string;
  /**
   * `self.crossOriginIsolated` in the worker. False means no SharedArrayBuffer,
   * so the wasm runtime is stuck at one thread whatever `threads` says.
   */
  crossOriginIsolated: boolean;
  /** Threads configured for the wasm runtime hosting the execution provider. */
  threads: number;
  /**
   * What the loaded `.onnx` file says about itself, the one way to tell which
   * weights a device is actually running: the URL only says which entry asked
   * for them, while a `props.release_tag` disagreeing with the entry's pinned
   * revision means a cache is serving something else. Absent when the bytes did
   * not parse, and `props` is empty for exports predating v3.7.
   */
  modelFile?: OnnxMetadata;
};

const isBackendProbe = (value: unknown): value is BackendProbe => {
  return (
    isPlainObject(value) &&
    (value.sessionError === undefined || isString(value.sessionError)) &&
    isBoolean(value.graphCapture) &&
    (value.graphCaptureError === undefined ||
      isString(value.graphCaptureError)) &&
    isBoolean(value.crossOriginIsolated) &&
    isNumber(value.threads) &&
    (value.modelFile === undefined || isOnnxMetadata(value.modelFile))
  );
};

/**
 * What the load produced, read off the built session rather than declared.
 * Reported on `ready` so the add flow can show what a candidate checkpoint
 * detects before anyone commits to running it.
 */
export type LoadedSummary = {
  headWidth: number;
  classes: readonly DetectionClass[];
};

const isLoadedSummary = (value: unknown): value is LoadedSummary =>
  isPlainObject(value) &&
  isNumber(value.headWidth) &&
  Array.isArray(value.classes) &&
  value.classes.every(isDetectionClass);

export type WorkerResponse =
  | { type: "model-load-start"; fromCache: boolean }
  | { type: "model-progress"; progress: ModelFileProgress }
  /**
   * The weights finished streaming, before a session is built from them. Sent
   * only for an actual download, so downloads can be counted separately from
   * sessions that started from cached bytes.
   */
  | { type: "model-downloaded"; durationMs: number }
  | { type: "backend-probe"; probe: BackendProbe }
  /**
   * `wasmHeapBytes`, here and on both scan replies, is the runtime's current
   * heap size, the crash sentinel's prime suspect for an iOS memory kill. On
   * `ready` it is the post-load baseline, separating what loading cost from what
   * scanning grew. Absent when the capture could not see the heap.
   */
  | { type: "ready"; loaded?: LoadedSummary; wasmHeapBytes?: number }
  | {
      type: "detections";
      detections: RawDetection[];
      timing: FrameTiming;
      crop?: DetectionCrop;
      wasmHeapBytes?: number;
      /**
       * How far the gate measured this frame from the last one scanned. On
       * results as well as skips, so the threshold can be read from both sides:
       * skips alone only show values below the line, which says nothing about
       * how close a gate that never fires is to firing. Absent on a worker's
       * first scan, which had no earlier frame to measure against.
       */
      sceneDelta?: number;
    }
  /**
   * The frame was close enough to the last one scanned that the model did not
   * run. A reply in its own right rather than an empty `detections`, which would
   * age the coasting tracker and decay the meter: a scene that did not change
   * cannot have lost the vehicle the last real scan found.
   */
  | {
      type: "scan-skipped";
      gateMs: number;
      delta: number;
      wasmHeapBytes?: number;
    }
  | {
      type: "worker-error";
      code: DetectionErrorCode;
      /**
       * What the platform said about the failure, today only for
       * GPU_DEVICE_LOST. Diagnostic only: nothing branches on it, it rides to
       * analytics so a field failure names its own cause rather than arriving as
       * a bare code.
       */
      detail?: string;
      /**
       * The bounded loss classification, the one part of a loss the crash
       * sentinel's log may carry, so a page killed moments after the GPU process
       * dies still names the loss at the next launch.
       */
      reason?: GpuDeviceLostReason;
    };

/**
 * Crop factor a detect request scans at: the full centered square (ZOOM_OFF)
 * or the half-side 2x crop (ZOOM_2X).
 */
export type ZoomLevel = typeof ZOOM_OFF | typeof ZOOM_2X;

export const isWorkerResponse = (value: unknown): value is WorkerResponse => {
  if (!isPlainObject(value)) {
    return false;
  }
  switch (value.type) {
    case "model-load-start":
      return isBoolean(value.fromCache);
    case "model-progress":
      return isModelFileProgress(value.progress);
    case "model-downloaded":
      return isNumber(value.durationMs);
    case "backend-probe":
      return isBackendProbe(value.probe);
    case "ready":
      return (
        (value.loaded === undefined || isLoadedSummary(value.loaded)) &&
        (value.wasmHeapBytes === undefined || isNumber(value.wasmHeapBytes))
      );
    case "detections":
      return (
        Array.isArray(value.detections) &&
        value.detections.every(isRawDetection) &&
        isFrameTiming(value.timing) &&
        (value.crop === undefined || isDetectionCrop(value.crop)) &&
        (value.sceneDelta === undefined || isNumber(value.sceneDelta)) &&
        (value.wasmHeapBytes === undefined || isNumber(value.wasmHeapBytes))
      );
    case "scan-skipped":
      return (
        isNumber(value.gateMs) &&
        isNumber(value.delta) &&
        (value.wasmHeapBytes === undefined || isNumber(value.wasmHeapBytes))
      );
    case "worker-error":
      return (
        isDetectionErrorCode(value.code) &&
        (value.detail === undefined || isString(value.detail)) &&
        (value.reason === undefined || isGpuDeviceLostReason(value.reason))
      );
    default:
      return false;
  }
};
