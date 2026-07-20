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
  /** The adapter advertises the `shader-f16` feature (needed for the fp16 build). */
  shaderF16: boolean;
  /** InferenceSession.create failure message for the WebGPU attempt, if any. */
  sessionError?: string;
  /** Backend actually selected after probing and any fallback. */
  chosen: DetectionBackend;
};

const isBackendProbe = (value: unknown): value is BackendProbe => {
  return (
    isPlainObject(value) &&
    isBoolean(value.workerGpu) &&
    isBoolean(value.adapter) &&
    isBoolean(value.device) &&
    isBoolean(value.shaderF16) &&
    (value.sessionError === undefined || isString(value.sessionError)) &&
    isDetectionBackend(value.chosen)
  );
};

export type WorkerResponse =
  | { type: "model-load-start"; fromCache: boolean }
  | { type: "model-progress"; progress: ModelFileProgress }
  | { type: "backend-probe"; probe: BackendProbe }
  | { type: "ready"; backend: DetectionBackend }
  | { type: "detections"; detections: RawDetection[]; timing: FrameTiming }
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
        isFrameTiming(value.timing)
      );
    case "worker-error":
      return isDetectionErrorCode(value.code);
    default:
      return false;
  }
};
