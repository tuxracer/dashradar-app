/// <reference lib="webworker" />
import { InferenceSession, Tensor } from "onnxruntime-web";
import { CONFIDENCE_THRESHOLD } from "@/lib/detection";
import { INPUT_SIZE, MODEL_URL_BY_BACKEND } from "./consts";
import { decodeDetections, preprocess } from "./inference";
import type { DetectionBackend, WorkerResponse } from "./types";
import { DetectionError, isWorkerRequest } from "./types";

declare const self: DedicatedWorkerGlobalScope;

/** Names discovered from the session graph, resolved at load time. */
type ModelIo = {
  session: InferenceSession;
  inputName: string;
  detsName: string;
  labelsName: string;
};

let model: ModelIo | undefined;

const post = (message: WorkerResponse) => {
  self.postMessage(message);
};

/**
 * Pick the execution backend, probing for a usable WebGPU device rather than
 * only checking that the API exists. On some devices `navigator.gpu` is present
 * but no adapter or device can actually be acquired. If we trusted the API
 * check alone, we would download the larger fp16 build for WebGPU, fail at
 * session creation, then fall back to wasm and download the int8 build too. A
 * successful adapter + device probe here proves WebGPU works before we commit
 * to that larger download, so an unusable GPU goes straight to wasm and only
 * one set of weights is fetched.
 */
const resolveBackend = async (): Promise<DetectionBackend> => {
  if (!("gpu" in navigator) || !navigator.gpu) {
    return "wasm";
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      return "wasm";
    }
    const device = await adapter.requestDevice();
    // Release the probe device; onnxruntime-web acquires its own.
    device.destroy();
    return "webgpu";
  } catch {
    return "wasm";
  }
};

/** Expected output names; used when the graph does not expose them literally. */
const EXPECTED_DETS_NAME = "dets";
const EXPECTED_LABELS_NAME = "labels";

/**
 * Stream the model over the network, reporting byte progress, and return the
 * downloaded weights. Progress mirrors the old Transformers.js load UX.
 */
const fetchModel = async (url: string): Promise<Uint8Array> => {
  const file = url.slice(url.lastIndexOf("/") + 1);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new DetectionError("MODEL_LOAD_FAILED");
  }
  const total = Number(response.headers.get("Content-Length")) || 0;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    loaded += value.byteLength;
    post({ type: "model-progress", progress: { file, loaded, total } });
  }
  const buffer = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
};

/** Download and instantiate the session for one backend. */
const loadForBackend = async (backend: DetectionBackend): Promise<ModelIo> => {
  const weights = await fetchModel(MODEL_URL_BY_BACKEND[backend]);
  const session = await InferenceSession.create(weights, {
    executionProviders: [backend === "webgpu" ? "webgpu" : "wasm"],
  });
  const inputName = session.inputNames[0];
  const detsName = session.outputNames.includes(EXPECTED_DETS_NAME)
    ? EXPECTED_DETS_NAME
    : session.outputNames[0];
  const labelsName = session.outputNames.includes(EXPECTED_LABELS_NAME)
    ? EXPECTED_LABELS_NAME
    : session.outputNames[1];
  return { session, inputName, detsName, labelsName };
};

const loadModel = async () => {
  const preferredBackend = await resolveBackend();
  try {
    model = await loadForBackend(preferredBackend);
    post({ type: "ready", backend: preferredBackend });
    return;
  } catch {
    if (preferredBackend !== "webgpu") {
      post({ type: "worker-error", code: "MODEL_LOAD_FAILED" });
      return;
    }
  }

  // The WebGPU API was present but the session still failed to load (e.g. a
  // blocklisted or otherwise unusable adapter). That isn't fatal on its own,
  // so fall back to wasm once before giving up.
  try {
    model = await loadForBackend("wasm");
    post({ type: "ready", backend: "wasm" });
  } catch {
    post({ type: "worker-error", code: "MODEL_LOAD_FAILED" });
  }
};

const detect = async (frame: ImageBitmap) => {
  if (!model) {
    frame.close();
    return;
  }
  try {
    const preprocessStart = performance.now();
    const canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new DetectionError("INFERENCE_FAILED");
    }
    context.drawImage(frame, 0, 0, INPUT_SIZE, INPUT_SIZE);
    const imageData = context.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
    const input = new Tensor("float32", preprocess(imageData), [
      1,
      3,
      INPUT_SIZE,
      INPUT_SIZE,
    ]);
    const preprocessMs = performance.now() - preprocessStart;

    const inferenceStart = performance.now();
    const outputs = await model.session.run({ [model.inputName]: input });
    const inferenceMs = performance.now() - inferenceStart;

    const decodeStart = performance.now();
    const dets = outputs[model.detsName].data as Float32Array;
    const labels = outputs[model.labelsName].data as Float32Array;
    const detections = decodeDetections(dets, labels, CONFIDENCE_THRESHOLD);
    const decodeMs = performance.now() - decodeStart;

    post({
      type: "detections",
      detections,
      timing: { preprocessMs, inferenceMs, decodeMs },
    });
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
