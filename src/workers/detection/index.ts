/// <reference lib="webworker" />
// The /webgpu subpath is deliberate: it runs WebGPU through the native C++
// WebGPU EP (asyncify runtime), not the root import's JSEP TypeScript kernels.
// JSEP has no TopK kernel, which parks this graph's TopK on the CPU EP and
// makes graph capture impossible; the native EP has one. Its WASM EP also runs
// the int8 build, so this one import covers both backends.
import { env, InferenceSession, Tensor } from "onnxruntime-web/webgpu";
import { isWebKitUa } from "@/lib/browserEngine";
import { CONFIDENCE_THRESHOLD } from "@/lib/detection";
import {
  FRAME_JPEG_QUALITY,
  INPUT_SIZE,
  MODEL_URL_BY_BACKEND,
  WASM_THREAD_CAP,
  WEBGPU_GRAPH_CAPTURE,
} from "./consts";
import {
  cropRect,
  decodeDetections,
  ensureCapacity,
  preprocess,
  topDetectionIndex,
} from "./inference";
import type {
  BackendProbe,
  DetectionBackend,
  DetectionCrop,
  WorkerResponse,
} from "./types";
import { DetectionError, isWorkerRequest } from "./types";

declare const self: DedicatedWorkerGlobalScope;

// Load onnxruntime-web's wasm runtime from our own origin (served at /ort/ by
// the ortRuntime Vite plugin) instead of cdn.jsdelivr.net, so cross-origin
// isolation does not block it and there is no live CDN dependency.
env.wasm.wasmPaths = `${import.meta.env.BASE_URL}ort/`;

/** WASM thread count for this device, capped for big.LITTLE efficiency. */
const wasmThreads = Math.min(
  navigator.hardwareConcurrency || WASM_THREAD_CAP,
  WASM_THREAD_CAP,
);
env.wasm.numThreads = wasmThreads;

/**
 * State for a WebGPU session created with graph capture enabled. The input
 * lives in one persistent GPU buffer: a capture session rejects CPU-located
 * input tensors at run(), so each frame is written into this buffer with
 * `device.queue.writeBuffer` and the session always sees the same
 * `Tensor.fromGpuBuffer` wrapper.
 */
type CaptureIo = {
  device: GPUDevice;
  inputGpuBuffer: GPUBuffer;
  inputTensor: Tensor;
};

/** Names discovered from the session graph, resolved at load time. */
type ModelIo = {
  session: InferenceSession;
  inputName: string;
  detsName: string;
  labelsName: string;
  /** Present when the session runs with WebGPU graph capture (gpu-buffer IO). */
  capture?: CaptureIo;
  /** Why the graph-capture attempt fell back to a plain session, if it did. */
  captureError?: string;
};

let model: ModelIo | undefined;

// Reused across every frame to keep the detection hot path allocation-free.
// Creating a canvas/context and a ~3 MB input tensor per frame otherwise
// produces steady garbage that shows up as GC jank on mobile. Safe to share
// because only one frame is ever in flight (see DetectionContext's frame pump):
// the previous frame's inference has fully consumed the buffer before the next
// frame overwrites it. `willReadFrequently` keeps the canvas CPU-backed so the
// per-frame getImageData readback stays cheap.
const inputCanvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
const inputContext = inputCanvas.getContext("2d", { willReadFrequently: true });
const inputBuffer = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);

const post = (message: WorkerResponse, transfer: Transferable[] = []) => {
  self.postMessage(message, transfer);
};

/** Backend choice plus the per-stage evidence gathered while deciding. */
type BackendChoice = {
  backend: DetectionBackend;
  probe: Omit<
    BackendProbe,
    "chosen" | "sessionError" | "graphCapture" | "graphCaptureError"
  >;
};

/**
 * Pick the execution backend, probing for a usable WebGPU device rather than
 * only checking that the API exists. On some devices `navigator.gpu` is present
 * but no adapter or device can actually be acquired. If we trusted the API
 * check alone, we would download the much larger WebGPU build, fail at
 * session creation, then fall back to wasm and download the int8 build too. A
 * successful adapter + device probe here proves WebGPU works before we commit
 * to that larger download, so an unusable GPU goes straight to wasm and only
 * one set of weights is fetched.
 *
 * WebGPU is also gated on the adapter exposing `shader-f16`. Any fp16 tensor
 * in a model graph makes onnxruntime-web require that feature at session
 * creation, so gating here keeps the backend choice a clean two-way split:
 * the webgpu URL can point at an fp16 (or mixed-precision) build without a
 * third fp32-fallback branch, and an adapter without the feature goes straight
 * to wasm instead of failing the session and double-downloading. GPUs lacking
 * `shader-f16` are rare on the phones this app targets.
 *
 * Runs in the worker scope, which is where onnxruntime-web needs WebGPU: some
 * browsers expose `navigator.gpu` on the main thread but not inside a worker.
 * The returned `probe` records how far each stage got so the debug overlay can
 * report why an apparently WebGPU-capable device fell back to wasm.
 */
const resolveBackend = async (): Promise<BackendChoice> => {
  const probe = {
    workerGpu: false,
    adapter: false,
    device: false,
    shaderF16: false,
    crossOriginIsolated: self.crossOriginIsolated,
    threads: wasmThreads,
  };
  if (!("gpu" in navigator) || !navigator.gpu) {
    return { backend: "wasm", probe };
  }
  probe.workerGpu = true;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      return { backend: "wasm", probe };
    }
    probe.adapter = true;
    probe.shaderF16 = adapter.features.has("shader-f16");
    if (!probe.shaderF16) {
      return { backend: "wasm", probe };
    }
    const device = await adapter.requestDevice();
    probe.device = true;
    // Release the probe device; onnxruntime-web acquires its own.
    device.destroy();
    return { backend: "webgpu", probe };
  } catch {
    return { backend: "wasm", probe };
  }
};

/** Best-effort human-readable message for an unknown thrown value. */
const describeError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  return String(error);
};

/** Expected output names; used when the graph does not expose them literally. */
const EXPECTED_DETS_NAME = "dets";
const EXPECTED_LABELS_NAME = "labels";

/**
 * Look up an already-cached copy of the model weights in CacheStorage. The
 * Workbox "model-cache" route (see vite.config.ts) stores the weights the first
 * time they are fetched, keyed on the stable request URL, and CacheStorage is
 * shared between the service worker and this worker. A hit here means the bytes
 * are already local: the load is not a network download, so the UI should skip
 * the download-progress screen entirely. Returns undefined in dev (no service
 * worker, so nothing is cached) and on any CacheStorage error.
 */
const matchCachedModel = async (url: string): Promise<Response | undefined> => {
  if (!("caches" in self)) {
    return undefined;
  }
  try {
    return await caches.match(url);
  } catch {
    return undefined;
  }
};

/**
 * Stream the model over the network, reporting byte progress, and return the
 * downloaded weights. Progress mirrors the old Transformers.js load UX.
 *
 * Chunks stream directly into one buffer preallocated from Content-Length
 * rather than being accumulated and copied into a second buffer at the end.
 * The fp32 build is ~118 MB, so accumulate-then-copy briefly holds both
 * copies (~236 MB) right before InferenceSession.create makes its own, which
 * risks an OOM worker crash on low-RAM phones at first load. When
 * Content-Length is missing or understates the body (e.g. a compressed
 * transfer), ensureCapacity grows the buffer instead, so the copy-free path
 * is an optimization, not a correctness requirement.
 */
const fetchModel = async (url: string): Promise<Uint8Array> => {
  const file = url.slice(url.lastIndexOf("/") + 1);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new DetectionError("MODEL_LOAD_FAILED");
  }
  const total = Number(response.headers.get("Content-Length")) || 0;
  const reader = response.body.getReader();
  let buffer = new Uint8Array(total);
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer = ensureCapacity(buffer, loaded, loaded + value.byteLength);
    buffer.set(value, loaded);
    loaded += value.byteLength;
    post({ type: "model-progress", progress: { file, loaded, total } });
  }
  // A subarray, not a slice: a slice would copy and recreate the exact
  // double-buffer peak this preallocation exists to avoid.
  return loaded === buffer.byteLength ? buffer : buffer.subarray(0, loaded);
};

/** Resolve the graph's input/output names from a freshly created session. */
const resolveIoNames = (
  session: InferenceSession,
): Pick<ModelIo, "inputName" | "detsName" | "labelsName"> => {
  const inputName = session.inputNames[0];
  const detsName = session.outputNames.includes(EXPECTED_DETS_NAME)
    ? EXPECTED_DETS_NAME
    : session.outputNames[0];
  const labelsName = session.outputNames.includes(EXPECTED_LABELS_NAME)
    ? EXPECTED_LABELS_NAME
    : session.outputNames[1];
  return { inputName, detsName, labelsName };
};

/**
 * Create a WebGPU session with graph capture enabled. Capture records the
 * model's kernel dispatches on the first run and replays them on later runs,
 * cutting the per-frame CPU overhead of dispatching RF-DETR's hundreds of
 * small kernels. Capture requires every graph node on the WebGPU EP, which
 * this graph only satisfies on the native C++ WebGPU EP (see the
 * `WEBGPU_GRAPH_CAPTURE` doc in consts.ts and the import note at the top of
 * this file).
 *
 * A capture session only accepts GPU-located IO, so the input is one
 * persistent GPU buffer written per frame and outputs are forced to
 * `gpu-buffer` and read back with `getData(true)`.
 *
 * The first run here is deliberate: it performs the actual capture, doubles as
 * shader warm-up, and surfaces run-time capture incompatibility (which does
 * not always fail at session creation) while the caller can still fall back
 * to a plain session cheaply, with the weights still in scope. Throws on any
 * failure after releasing whatever was created.
 */
const createCaptureModel = async (weights: Uint8Array): Promise<ModelIo> => {
  const session = await InferenceSession.create(weights, {
    executionProviders: ["webgpu"],
    enableGraphCapture: true,
    preferredOutputLocation: "gpu-buffer",
  });
  let inputGpuBuffer: GPUBuffer | undefined;
  try {
    // The device must come from ORT after session creation so the buffer is
    // created on the same GPUDevice the backend runs on.
    const device = await env.webgpu.device;
    inputGpuBuffer = device.createBuffer({
      size: inputBuffer.byteLength,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });
    const inputTensor = Tensor.fromGpuBuffer(inputGpuBuffer, {
      dataType: "float32",
      dims: [1, 3, INPUT_SIZE, INPUT_SIZE],
    });
    const io = resolveIoNames(session);
    // Validation + capture run on the (still zeroed) input buffer.
    device.queue.writeBuffer(inputGpuBuffer, 0, inputBuffer);
    const outputs = await session.run({ [io.inputName]: inputTensor });
    await outputs[io.detsName].getData(true);
    await outputs[io.labelsName].getData(true);
    return { session, ...io, capture: { device, inputGpuBuffer, inputTensor } };
  } catch (error) {
    inputGpuBuffer?.destroy();
    try {
      await session.release();
    } catch {
      // The session may already be unusable; releasing is best-effort.
    }
    throw error;
  }
};

/** Download and instantiate the session for one backend. */
const loadForBackend = async (backend: DetectionBackend): Promise<ModelIo> => {
  const url = MODEL_URL_BY_BACKEND[backend];
  const cached = await matchCachedModel(url);
  // Tell the context whether this is a network download so it can show the
  // download-progress screen only when we are actually downloading, not when
  // reading already-cached weights (a cache read still takes a beat to compile
  // the ONNX session, which otherwise flashes a misleading "downloading" UI).
  post({ type: "model-load-start", fromCache: cached !== undefined });
  const weights = cached
    ? new Uint8Array(await cached.arrayBuffer())
    : await fetchModel(url);
  let captureError: string | undefined;
  // Never attempt graph capture on WebKit: crash telemetry (DASHRADAR-2)
  // shows iOS Safari killing the page within seconds of scanning with
  // capture on, and capture was only ever verified on Chrome. The plain
  // WebGPU session below is the WebKit path until telemetry clears capture.
  if (
    backend === "webgpu" &&
    WEBGPU_GRAPH_CAPTURE &&
    !isWebKitUa(navigator.userAgent)
  ) {
    try {
      return await createCaptureModel(weights);
    } catch (error) {
      // Capture may not work on this device or export; fall back to a plain
      // WebGPU session and record why for the debug overlay.
      captureError = describeError(error);
    }
  }
  const session = await InferenceSession.create(weights, {
    executionProviders: [backend === "webgpu" ? "webgpu" : "wasm"],
  });
  return { session, ...resolveIoNames(session), captureError };
};

const loadModel = async () => {
  const { backend: preferredBackend, probe } = await resolveBackend();
  let sessionError: string | undefined;
  try {
    model = await loadForBackend(preferredBackend);
    post({
      type: "backend-probe",
      probe: {
        ...probe,
        chosen: preferredBackend,
        graphCapture: model.capture !== undefined,
        graphCaptureError: model.captureError,
      },
    });
    post({ type: "ready", backend: preferredBackend });
    return;
  } catch (error) {
    // The WebGPU probe passed but the session still failed to build (e.g. a
    // blocklisted adapter, or the fp16 build needing a `shader-f16` feature the
    // GPU lacks). Record why so the debug overlay can show it.
    sessionError = describeError(error);
    if (preferredBackend !== "webgpu") {
      post({
        type: "backend-probe",
        probe: { ...probe, chosen: "wasm", sessionError, graphCapture: false },
      });
      post({ type: "worker-error", code: "MODEL_LOAD_FAILED" });
      return;
    }
  }

  // Fall back to wasm once before giving up on a failed WebGPU session.
  try {
    model = await loadForBackend("wasm");
    post({
      type: "backend-probe",
      probe: { ...probe, chosen: "wasm", sessionError, graphCapture: false },
    });
    post({ type: "ready", backend: "wasm" });
  } catch {
    post({
      type: "backend-probe",
      probe: { ...probe, chosen: "wasm", sessionError, graphCapture: false },
    });
    post({ type: "worker-error", code: "MODEL_LOAD_FAILED" });
  }
};

/**
 * Encode the full inference frame as a JPEG blob for debug-mode frame saving.
 * Best-effort like the crop: any failure returns undefined and never blocks
 * the detection result.
 */
const encodeFrame = async (frame: ImageBitmap): Promise<Blob | undefined> => {
  try {
    const canvas = new OffscreenCanvas(frame.width, frame.height);
    const context = canvas.getContext("2d");
    if (!context) {
      return undefined;
    }
    context.drawImage(frame, 0, 0);
    return await canvas.convertToBlob({
      type: "image/jpeg",
      quality: FRAME_JPEG_QUALITY,
    });
  } catch {
    return undefined;
  }
};

const detect = async (frame: ImageBitmap, includeFrame: boolean) => {
  if (!model) {
    frame.close();
    return;
  }
  try {
    const preprocessStart = performance.now();
    if (!inputContext) {
      throw new DetectionError("INFERENCE_FAILED");
    }
    inputContext.drawImage(frame, 0, 0, INPUT_SIZE, INPUT_SIZE);
    const imageData = inputContext.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
    const inputData = preprocess(imageData, inputBuffer);
    const preprocessMs = performance.now() - preprocessStart;

    // The capture path writes the frame into the persistent GPU input buffer
    // and reads the gpu-buffer outputs back with getData(true), which both
    // downloads the data and releases the GPU-side output. Its inference time
    // therefore includes the readback (the GPU sync point), matching what the
    // plain path's run() already includes.
    const inferenceStart = performance.now();
    let dets: Float32Array;
    let labels: Float32Array;
    if (model.capture) {
      const { device, inputGpuBuffer, inputTensor } = model.capture;
      device.queue.writeBuffer(inputGpuBuffer, 0, inputData);
      const outputs = await model.session.run({
        [model.inputName]: inputTensor,
      });
      dets = (await outputs[model.detsName].getData(true)) as Float32Array;
      labels = (await outputs[model.labelsName].getData(true)) as Float32Array;
    } else {
      const input = new Tensor("float32", inputData, [
        1,
        3,
        INPUT_SIZE,
        INPUT_SIZE,
      ]);
      const outputs = await model.session.run({ [model.inputName]: input });
      dets = outputs[model.detsName].data as Float32Array;
      labels = outputs[model.labelsName].data as Float32Array;
    }
    const inferenceMs = performance.now() - inferenceStart;

    const decodeStart = performance.now();
    const detections = decodeDetections(dets, labels, CONFIDENCE_THRESHOLD);
    const decodeMs = performance.now() - decodeStart;

    // Cut the highest-scoring detection out of the full-resolution frame so
    // the UI can show what was detected. Best-effort: a failed cutout never
    // blocks the detection result.
    let crop: DetectionCrop | undefined;
    const topIndex = topDetectionIndex(detections);
    if (topIndex !== undefined) {
      const rect = cropRect(
        detections[topIndex].box,
        frame.width,
        frame.height,
      );
      if (rect) {
        try {
          const image = await createImageBitmap(
            frame,
            rect.sx,
            rect.sy,
            rect.sw,
            rect.sh,
            { resizeWidth: rect.resizeWidth, resizeHeight: rect.resizeHeight },
          );
          crop = { image, detectionIndex: topIndex };
        } catch {
          // Degenerate rect or platform limitation; send the result without it.
        }
      }
    }

    // Full-frame JPEG for debug-mode saving, gated on the same condition that
    // attempts the crop; the context only surfaces it beside a valid crop
    // from the same message.
    let fullFrame: Blob | undefined;
    if (includeFrame && topIndex !== undefined) {
      fullFrame = await encodeFrame(frame);
    }

    post(
      {
        type: "detections",
        detections,
        timing: { preprocessMs, inferenceMs, decodeMs },
        crop,
        frame: fullFrame,
      },
      crop ? [crop.image] : [],
    );
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
  void detect(request.frame, request.includeFrame ?? false);
};
