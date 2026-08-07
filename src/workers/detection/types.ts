import { isBoolean, isNumber, isPlainObject, isString } from "remeda";
import { isDetectionClass, isDetectionModel } from "@/lib/detectionModels";
import type { DetectionClass, DetectionModel } from "@/lib/detectionModels";
import { isOnnxMetadata } from "@/lib/onnxMetadata";
import type { OnnxMetadata } from "@/lib/onnxMetadata";
import type { RawDetection } from "@/types";
import { isRawDetection } from "@/types";
import type { ZOOM_2X, ZOOM_OFF } from "./consts";

/**
 * WEBGPU_UNSUPPORTED is raised by the GPU probe, before any weights are
 * fetched, on a device that cannot run the detector at all: no `navigator.gpu`
 * in the worker scope, no adapter or device, or an adapter without
 * `shader-f16`. It is terminal rather than a fallback because there is no
 * second execution path left — CPU (wasm) inference was dropped after
 * measuring ~10 s round trips against WebGPU's ~500 ms on the same phone,
 * which is far too slow to be worth shipping (a detector that scans once every
 * ten seconds misses most of what it drives past).
 *
 * GPU_DEVICE_LOST is raised when the WebGPU device backing an already-loaded
 * session is lost. WebKit runs WebGPU in a separate GPU process, so that
 * process dying (a Metal command-buffer abort, its own memory pressure, a
 * driver fault) takes the device while the page itself keeps running. Without
 * it the app notices only on the next frame, as a generic INFERENCE_FAILED that
 * cannot be told apart from a decode fault. Naming the cause is what lets
 * telemetry separate a GPU-process death from the OS killing the whole page,
 * which runs no JS at all and so reports nothing beyond the crash sentinel.
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
 * Bounded classification of a GPU device loss, mirroring the platform's
 * GPUDeviceLostReason enum. Kept separate from `detail`'s free text because
 * this value travels into the crash sentinel's session log, which only ever
 * ships bounded values; the guard enforcing the enum is what keeps a
 * platform's message from riding through as a "reason".
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
   * Resolve whether this device can run the detector, without downloading
   * anything. Sent as soon as the worker exists, ahead of `load`, so an
   * unsupported device is told so before the app asks for the camera and
   * before a byte of the model is fetched. On failure the worker answers with
   * a WEBGPU_UNSUPPORTED `worker-error`; on success it stays quiet and waits
   * for `load`.
   */
  | { type: "probe" }
  /**
   * Build a session for this model entry, downloading its weights if they are
   * not already cached. The entry itself travels on the message because a
   * worker has no localStorage to read the selection or the stored models
   * from. An omitted entry loads DEFAULT_MODEL, which keeps a recycle safe
   * whatever happens to storage underneath it.
   */
  | { type: "load"; model?: DetectionModel }
  | {
      type: "detect";
      frame: ImageBitmap;
      /**
       * When false, the worker skips cutting the top detection out of the
       * frame, so a detection comes back without its image. Set from the
       * detection-image setting, which turns the contact card off. Omitting it
       * includes the cutout, the production default.
       */
      includeCrop?: boolean;
      /**
       * Factor by which to shrink the centered square crop the worker feeds the
       * model, so the input covers a narrower field of view. 1 (the default
       * when omitted) is the full centered square; ZOOM_2X halves it. Set from
       * the zoom setting (or its auto machine).
       */
      zoom?: number;
      /**
       * Intrinsic size of the video frame `frame` was cut from, present only
       * when the sender already applied the zoom crop and scaled the result to
       * the model's input size. The worker then scales the bitmap straight onto
       * the input instead of cropping it again, and maps boxes back through
       * these dimensions rather than the bitmap's, so detections stay in
       * full-frame coordinates either way.
       *
       * The sender pre-crops only when no cutout is wanted, because the cutout
       * is the one consumer that needs the frame's original pixels. Omitting
       * this means `frame` is the whole video frame and the worker crops it.
       */
      source?: { width: number; height: number };
      /**
       * Minimum detection confidence for this frame's decode. When omitted the
       * worker uses the CONFIDENCE_THRESHOLD default (the production floor).
       * Set from the developer confidence-threshold setting so a lowered value
       * reaches decodeDetections, which filters before anything leaves the
       * worker.
       */
      confidenceThreshold?: number;
      /**
       * Run inference on this frame whatever the scene-change gate makes of it.
       * The worker measures how far the picture moved since the frame it last
       * scanned and can answer `scan-skipped` instead of running the model, but
       * it is deliberately not the one deciding when that shortcut has gone on
       * too long: the sender owns that, because only the sender knows when
       * scanning last produced a real answer and when a pause interrupted it.
       * Omitting it lets the gate decide, the production default.
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
 * Cutout of the highest-scoring detection, cropped by the worker from the
 * exact frame inference ran on (the main thread never sees that frame; it is
 * transferred into the worker and closed after inference).
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
 * How the detector's backend came up, and what the weights it came up on say
 * about themselves. Reported once per worker after `load`. The GPU probe's own
 * verdict is not in here: a device that fails it never reaches this message, it
 * gets WEBGPU_UNSUPPORTED and the unsupported-device screen, so anything
 * reading this probe is already running on WebGPU.
 */
export type BackendProbe = {
  /** InferenceSession.create failure message for the WebGPU attempt, if any. */
  sessionError?: string;
  /**
   * The WebGPU session was created with graph capture enabled (kernel
   * dispatches recorded on the first run and replayed on later runs). False
   * means either the `WEBGPU_GRAPH_CAPTURE` flag is off (no attempt was made)
   * or the attempt failed and the worker fell back to a plain WebGPU session;
   * `graphCaptureError` is set only in the failed case.
   */
  graphCapture: boolean;
  /** Failure message from the graph-capture attempt when it fell back. */
  graphCaptureError?: string;
  /**
   * `self.crossOriginIsolated` in the worker. False here means SharedArrayBuffer
   * is unavailable, so onnxruntime-web's wasm runtime is stuck at one thread
   * regardless of `threads` below.
   */
  crossOriginIsolated: boolean;
  /**
   * Thread count configured for onnxruntime-web's wasm runtime
   * (`env.wasm.numThreads`). Inference itself runs on the GPU, but the runtime
   * hosting the WebGPU execution provider is still a wasm module and runs any
   * node the provider cannot take.
   */
  threads: number;
  /**
   * What the loaded `.onnx` file says about itself, read out of the downloaded
   * bytes by src/lib/onnxMetadata. This is the one way to tell which weights a
   * device is actually running: the URL only says which entry asked for them,
   * while a `props.release_tag` disagreeing with the registry entry's pinned
   * revision means a cache is serving something else. Absent when the bytes did
   * not parse, and `props` is empty for any build exported before the
   * checkpoint repo started stamping provenance in v3.7.
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
 * What the load actually produced, read off the built session: the head width
 * its labels output reported and the classes its own metadata named. Reported
 * on `ready` so the add flow can show what a candidate checkpoint detects
 * before anyone commits to running it.
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
   * The weights finished streaming over the network, before the ONNX session
   * is built from them. Sent only for an actual download, never for a cache
   * read, so the context can count fresh downloads (and how long they took)
   * separately from sessions that started from cached bytes.
   */
  | { type: "model-downloaded"; durationMs: number }
  | { type: "backend-probe"; probe: BackendProbe }
  /**
   * `wasmHeapBytes` (here and on both scan replies) is the current size of
   * onnxruntime-web's wasm heap, the crash sentinel's prime suspect for iOS
   * killing the page over its per-process memory limit. On `ready` it is the
   * post-load baseline, so a report can separate what loading the model cost
   * from what scanning grew. Absent when the capture could not see the heap.
   */
  | { type: "ready"; loaded?: LoadedSummary; wasmHeapBytes?: number }
  | {
      type: "detections";
      detections: RawDetection[];
      timing: FrameTiming;
      crop?: DetectionCrop;
      wasmHeapBytes?: number;
      /**
       * How far the scene-change gate measured this frame from the last one
       * scanned. Present on results as well as skips so the threshold can be
       * read against both sides of it: skips alone only ever show values below
       * the line, which says nothing about how close a gate that never fires is
       * to firing. Absent on the first scan of a worker, which had no earlier
       * frame to measure against.
       */
      sceneDelta?: number;
    }
  /**
   * The frame was close enough to the last one scanned that the worker did not
   * run the model on it. A reply in its own right rather than an empty
   * `detections`: an empty result would age the coasting tracker and decay the
   * meter, which would be a lie, since a scene that did not change cannot have
   * lost the vehicle the last real scan found. Carrying nothing but its own
   * cost and the measurement behind the verdict keeps every consumer of a
   * detection result untouched by a skip.
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
       * What the platform said about the failure, for the codes that have
       * something to report (today only GPU_DEVICE_LOST, carrying the
       * GPUDevice lost reason and message). Diagnostic only: nothing branches
       * on it, it rides along to analytics so a field failure names its own
       * cause instead of arriving as a bare code.
       */
      detail?: string;
      /**
       * The bounded loss classification, set only for GPU_DEVICE_LOST. This
       * is the one part of a loss the crash sentinel's log may carry, so a
       * page killed moments after the GPU process dies still names the loss
       * in its next-launch report; `detail` above stays out of that log.
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
