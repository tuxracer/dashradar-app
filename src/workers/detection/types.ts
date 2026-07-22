import { isBoolean, isNumber, isPlainObject, isString } from "remeda";
import type { RawDetection } from "@/types";
import { isRawDetection } from "@/types";

export type DetectionBackend = "webgpu" | "wasm";

const DETECTION_BACKENDS: readonly DetectionBackend[] = ["webgpu", "wasm"];

export const isDetectionBackend = (
  value: unknown,
): value is DetectionBackend => {
  return (
    isString(value) && DETECTION_BACKENDS.includes(value as DetectionBackend)
  );
};

export type DetectionErrorCode =
  | "MODEL_LOAD_FAILED"
  | "INFERENCE_FAILED"
  | "WORKER_CRASHED";

const DETECTION_ERROR_CODES: readonly DetectionErrorCode[] = [
  "MODEL_LOAD_FAILED",
  "INFERENCE_FAILED",
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

export type WorkerRequest =
  | { type: "load" }
  | { type: "detect"; frame: ImageBitmap };

export const isWorkerRequest = (value: unknown): value is WorkerRequest => {
  if (!isPlainObject(value)) {
    return false;
  }
  if (value.type === "load") {
    return true;
  }
  return value.type === "detect" && value.frame instanceof ImageBitmap;
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
 * Outcome of the WebGPU backend probe, reported once at load so the debug
 * overlay can explain why the CPU (wasm) fallback was chosen on a device whose
 * main thread reports WebGPU support. Each flag records how far the probe got
 * inside the worker scope (where onnxruntime-web actually runs), and
 * `sessionError` carries the InferenceSession.create failure message when the
 * probe succeeded but the WebGPU session still would not build (e.g. the fp16
 * build needs the `shader-f16` GPU feature the adapter lacks).
 */
export type BackendProbe = {
  /** `navigator.gpu` is present in the worker's own global scope. */
  workerGpu: boolean;
  /** `requestAdapter()` returned a usable adapter. */
  adapter: boolean;
  /** `requestDevice()` succeeded. */
  device: boolean;
  /**
   * The adapter advertises the `shader-f16` feature. Load-bearing: the WebGPU
   * backend serves the mixed-precision fp16 build, whose fp16 tensors make
   * onnxruntime-web require this feature at session creation, so a device
   * without it goes straight to wasm instead of failing the session.
   */
  shaderF16: boolean;
  /** InferenceSession.create failure message for the WebGPU attempt, if any. */
  sessionError?: string;
  /**
   * The WebGPU session was created with graph capture enabled (kernel
   * dispatches recorded on the first run and replayed on later runs). Always
   * false on the wasm backend. False on webgpu means either the
   * `WEBGPU_GRAPH_CAPTURE` flag is off (no attempt was made) or the attempt
   * failed and the worker fell back to a plain WebGPU session;
   * `graphCaptureError` is set only in the failed case.
   */
  graphCapture: boolean;
  /** Failure message from the graph-capture attempt when it fell back. */
  graphCaptureError?: string;
  /** Backend actually selected after probing and any fallback. */
  chosen: DetectionBackend;
  /**
   * `self.crossOriginIsolated` in the worker. False here means SharedArrayBuffer
   * is unavailable, so the WASM backend is stuck at one thread regardless of
   * `threads` below.
   */
  crossOriginIsolated: boolean;
  /** WASM thread count configured for onnxruntime-web (`env.wasm.numThreads`). */
  threads: number;
};

const isBackendProbe = (value: unknown): value is BackendProbe => {
  return (
    isPlainObject(value) &&
    isBoolean(value.workerGpu) &&
    isBoolean(value.adapter) &&
    isBoolean(value.device) &&
    isBoolean(value.shaderF16) &&
    (value.sessionError === undefined || isString(value.sessionError)) &&
    isBoolean(value.graphCapture) &&
    (value.graphCaptureError === undefined ||
      isString(value.graphCaptureError)) &&
    isDetectionBackend(value.chosen) &&
    isBoolean(value.crossOriginIsolated) &&
    isNumber(value.threads)
  );
};

export type WorkerResponse =
  | { type: "model-load-start"; fromCache: boolean }
  | { type: "model-progress"; progress: ModelFileProgress }
  | { type: "backend-probe"; probe: BackendProbe }
  | { type: "ready"; backend: DetectionBackend }
  | {
      type: "detections";
      detections: RawDetection[];
      timing: FrameTiming;
      crop?: DetectionCrop;
    }
  | { type: "worker-error"; code: DetectionErrorCode };

export const isWorkerResponse = (value: unknown): value is WorkerResponse => {
  if (!isPlainObject(value)) {
    return false;
  }
  switch (value.type) {
    case "model-load-start":
      return isBoolean(value.fromCache);
    case "model-progress":
      return isModelFileProgress(value.progress);
    case "backend-probe":
      return isBackendProbe(value.probe);
    case "ready":
      return isDetectionBackend(value.backend);
    case "detections":
      return (
        Array.isArray(value.detections) &&
        value.detections.every(isRawDetection) &&
        isFrameTiming(value.timing) &&
        (value.crop === undefined || isDetectionCrop(value.crop))
      );
    case "worker-error":
      return isDetectionErrorCode(value.code);
    default:
      return false;
  }
};
