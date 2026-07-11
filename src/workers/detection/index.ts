/// <reference lib="webworker" />
import { pipeline, RawImage } from "@huggingface/transformers";
import type {
  ObjectDetectionPipeline,
  ProgressCallback,
} from "@huggingface/transformers";
import { isNumber, isString } from "remeda";
import { CONFIDENCE_THRESHOLD } from "@/lib/detection";
import { DTYPE_BY_BACKEND, MODEL_ID } from "./consts";
import type { DetectionBackend, WorkerResponse } from "./types";
import { DetectionError, isWorkerRequest } from "./types";

declare const self: DedicatedWorkerGlobalScope;

let detector: ObjectDetectionPipeline | undefined;

const post = (message: WorkerResponse) => {
  self.postMessage(message);
};

const resolveBackend = (): DetectionBackend => {
  return "gpu" in navigator && navigator.gpu ? "webgpu" : "wasm";
};

const reportProgress: ProgressCallback = (info) => {
  if (
    info.status === "progress" &&
    isString(info.file) &&
    isNumber(info.loaded) &&
    isNumber(info.total)
  ) {
    post({
      type: "model-progress",
      progress: { file: info.file, loaded: info.loaded, total: info.total },
    });
  }
};

const loadPipeline = (backend: DetectionBackend) => {
  return pipeline("object-detection", MODEL_ID, {
    device: backend,
    dtype: DTYPE_BY_BACKEND[backend],
    progress_callback: reportProgress,
  });
};

const loadModel = async () => {
  const preferredBackend = resolveBackend();
  try {
    detector = await loadPipeline(preferredBackend);
    post({ type: "ready", backend: preferredBackend });
    return;
  } catch {
    if (preferredBackend !== "webgpu") {
      post({ type: "worker-error", code: "MODEL_LOAD_FAILED" });
      return;
    }
  }

  // The WebGPU API was present but the pipeline still failed to load (e.g. a
  // blocklisted or otherwise unusable adapter). That isn't fatal on its own,
  // so fall back to wasm once before giving up.
  try {
    detector = await loadPipeline("wasm");
    post({ type: "ready", backend: "wasm" });
  } catch {
    post({ type: "worker-error", code: "MODEL_LOAD_FAILED" });
  }
};

const detect = async (frame: ImageBitmap) => {
  if (!detector) {
    frame.close();
    return;
  }
  try {
    const canvas = new OffscreenCanvas(frame.width, frame.height);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new DetectionError("INFERENCE_FAILED");
    }
    context.drawImage(frame, 0, 0);
    const { data } = context.getImageData(0, 0, frame.width, frame.height);
    const image = new RawImage(data, frame.width, frame.height, 4);
    const detections = await detector(image, {
      threshold: CONFIDENCE_THRESHOLD,
      percentage: true,
    });
    post({ type: "detections", detections });
  } catch {
    post({ type: "worker-error", code: "INFERENCE_FAILED" });
  } finally {
    frame.close();
  }
};

self.onmessage = (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (!isWorkerRequest(request)) {
    return;
  }
  if (request.type === "load") {
    void loadModel();
    return;
  }
  void detect(request.frame);
};
