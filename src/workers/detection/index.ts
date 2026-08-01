/// <reference lib="webworker" />
// The /webgpu subpath is deliberate: it runs WebGPU through the native C++
// WebGPU EP (asyncify runtime), not the root import's JSEP TypeScript kernels.
// JSEP has no TopK kernel, which parks this graph's TopK on the CPU EP and
// makes graph capture impossible; the native EP has one.
import { env, InferenceSession, Tensor } from "onnxruntime-web/webgpu";
import { isWebKitUa } from "@/lib/browserEngine";
import { CONFIDENCE_THRESHOLD } from "@/lib/detection";
import {
  CROP_MAX_EDGE,
  DEV_MODEL_CACHE_NAME,
  FRAME_JPEG_QUALITY,
  INPUT_SIZE,
  MODEL_URL,
  WASM_THREAD_CAP,
  WEBGPU_GRAPH_CAPTURE,
  ZOOM_OFF,
} from "./consts";
import {
  centerCropRegion,
  cropRect,
  decodeDetections,
  ensureCapacity,
  frameBrightFraction,
  frameFingerprint,
  mapCropBoxToFrame,
  preprocess,
  topDetectionIndex,
} from "./inference";
import type { DetectionCrop, WorkerResponse } from "./types";
import { DetectionError, isWorkerRequest } from "./types";

declare const self: DedicatedWorkerGlobalScope;

// Load onnxruntime-web's wasm runtime from our own origin (served at /ort/ by
// the ortRuntime Vite plugin) instead of cdn.jsdelivr.net, so cross-origin
// isolation does not block it and there is no live CDN dependency.
env.wasm.wasmPaths = `${import.meta.env.BASE_URL}ort/`;

/** ORT wasm-runtime thread count for this device, capped for big.LITTLE. */
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

/** wasm-runtime facts reported alongside every session result. */
const wasmRuntime = {
  crossOriginIsolated: self.crossOriginIsolated,
  threads: wasmThreads,
};

/**
 * Decide whether this device can run the detector, by actually acquiring a
 * WebGPU device rather than only checking that the API exists. On some devices
 * `navigator.gpu` is present but no adapter or device can be obtained, so the
 * API check alone would let us download 57 MB of weights only to fail at
 * session creation.
 *
 * The adapter must also expose `shader-f16`. Any fp16 tensor in a model graph
 * makes onnxruntime-web require that feature at session creation, and the only
 * build shipped is mixed-precision fp16, so an adapter without it cannot run
 * this model at all. GPUs lacking `shader-f16` are rare on the phones this app
 * targets.
 *
 * A failure at any stage is terminal: with the CPU (wasm) path gone there is
 * nothing left to fall back to, so the caller reports WEBGPU_UNSUPPORTED and
 * the app shows the unsupported-device screen instead of scanning at a rate
 * too slow to catch anything.
 *
 * Runs in the worker scope, which is where onnxruntime-web needs WebGPU: some
 * browsers expose `navigator.gpu` on the main thread but not inside a worker.
 */
const probeWebGpu = async (): Promise<boolean> => {
  if (!("gpu" in navigator) || !navigator.gpu) {
    return false;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter || !adapter.features.has("shader-f16")) {
      return false;
    }
    const device = await adapter.requestDevice();
    // Release the probe device; onnxruntime-web acquires its own.
    device.destroy();
    return true;
  } catch {
    return false;
  }
};

/**
 * The one probe this worker runs, shared by the `probe` and `load` handlers.
 * Acquiring an adapter and device is not free, and `load` must see exactly the
 * verdict `probe` already reported rather than re-deciding.
 */
let gpuProbeResult: Promise<boolean> | undefined;
const gpuProbe = (): Promise<boolean> => (gpuProbeResult ??= probeWebGpu());

/**
 * Report that this device cannot run the detector. Idempotent, because both
 * the `probe` and `load` handlers reach it on an unsupported device and the
 * context must not see the terminal error twice.
 */
let unsupportedReported = false;
const reportUnsupported = () => {
  if (unsupportedReported) {
    return;
  }
  unsupportedReported = true;
  post({ type: "worker-error", code: "WEBGPU_UNSUPPORTED" });
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
 * Look up an already-cached copy of the model weights in CacheStorage. In
 * production the Workbox "model-cache" route (see vite.config.ts) stores the
 * weights the first time they are fetched, keyed on the stable request URL,
 * and CacheStorage is shared between the service worker and this worker. On
 * the dev server, where no service worker exists, cacheModelInDev below fills
 * the same role. A hit here means the bytes are already local: the load is
 * not a network download, so the UI should skip the download-progress screen
 * entirely. Returns undefined on any CacheStorage error.
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
const fetchModel = async (url: string): Promise<Uint8Array<ArrayBuffer>> => {
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

/**
 * Store freshly downloaded weights in CacheStorage on the dev server, where
 * no service worker exists to cache them, so later dev launches load the
 * model locally through matchCachedModel instead of re-downloading tens of
 * megabytes per reload. The entry is keyed on the revision-pinned URL, so a
 * MODEL_REVISION bump misses and re-downloads; entries for URLs no longer in
 * MODEL_URL (old revisions) are evicted so stale weights don't accumulate.
 * No-op in production builds and best-effort in dev: any failure just means a
 * re-download on the next launch.
 */
const cacheModelInDev = async (weights: Uint8Array<ArrayBuffer>) => {
  if (!import.meta.env.DEV || !("caches" in self)) {
    return;
  }
  try {
    const cache = await caches.open(DEV_MODEL_CACHE_NAME);
    for (const request of await cache.keys()) {
      if (request.url !== MODEL_URL) {
        await cache.delete(request);
      }
    }
    await cache.put(MODEL_URL, new Response(weights));
  } catch {
    // Dev convenience only; never let a cache failure affect the load.
  }
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

/** Download and instantiate the WebGPU session. */
const createModel = async (): Promise<ModelIo> => {
  const cached = await matchCachedModel(MODEL_URL);
  // Tell the context whether this is a network download so it can show the
  // download-progress screen only when we are actually downloading, not when
  // reading already-cached weights (a cache read still takes a beat to compile
  // the ONNX session, which otherwise flashes a misleading "downloading" UI).
  post({ type: "model-load-start", fromCache: cached !== undefined });
  let weights: Uint8Array<ArrayBuffer>;
  if (cached) {
    weights = new Uint8Array(await cached.arrayBuffer());
  } else {
    const downloadStartedAt = performance.now();
    weights = await fetchModel(MODEL_URL);
    // Report the completed download before the session is built from it, so a
    // device that downloads the weights but then fails session creation still
    // counts as a successful download.
    post({
      type: "model-downloaded",
      durationMs: performance.now() - downloadStartedAt,
    });
    await cacheModelInDev(weights);
  }
  let captureError: string | undefined;
  // Never attempt graph capture on WebKit: crash telemetry (DASHRADAR-2)
  // shows iOS Safari killing the page within seconds of scanning with
  // capture on, and capture was only ever verified on Chrome. The plain
  // WebGPU session below is the WebKit path until telemetry clears capture.
  if (WEBGPU_GRAPH_CAPTURE && !isWebKitUa(navigator.userAgent)) {
    try {
      return await createCaptureModel(weights);
    } catch (error) {
      // Capture may not work on this device or export; fall back to a plain
      // WebGPU session and record why for the debug overlay.
      captureError = describeError(error);
    }
  }
  const session = await InferenceSession.create(weights, {
    executionProviders: ["webgpu"],
  });
  return { session, ...resolveIoNames(session), captureError };
};

const loadModel = async () => {
  if (!(await gpuProbe())) {
    reportUnsupported();
    return;
  }
  try {
    model = await createModel();
    post({
      type: "backend-probe",
      probe: {
        ...wasmRuntime,
        graphCapture: model.capture !== undefined,
        graphCaptureError: model.captureError,
      },
    });
    post({ type: "ready" });
  } catch (error) {
    // The probe acquired a device but the session still failed to build (a
    // blocklisted adapter, an OOM on the weights, a corrupt download). There
    // is no second backend to try, so this is terminal; record why so the
    // debug overlay can show it.
    post({
      type: "backend-probe",
      probe: {
        ...wasmRuntime,
        sessionError: describeError(error),
        graphCapture: false,
      },
    });
    post({ type: "worker-error", code: "MODEL_LOAD_FAILED" });
  }
};

/**
 * Downscale the model's square input canvas to a thumbnail bitmap for the
 * contact card, shown on scans that had no detection to crop. Sourced from the
 * input canvas rather than the original frame so the card shows exactly what
 * the model saw: the centered square crop at the scan's zoom; the SAVE path
 * (encodeFrame) saves that same input at full size. The edge is capped at
 * CROP_MAX_EDGE (never upscaled), matching the detection crop's sizing.
 * Best-effort like the crop: any failure returns undefined and never blocks
 * the detection result.
 */
const createFrameThumbnail = async (): Promise<ImageBitmap | undefined> => {
  const edge = Math.min(CROP_MAX_EDGE, INPUT_SIZE);
  try {
    return await createImageBitmap(inputCanvas, {
      resizeWidth: edge,
      resizeHeight: edge,
    });
  } catch {
    return undefined;
  }
};

/**
 * Encode the model's square input canvas as a JPEG blob for the frame-saving
 * option. Saving the input rather than the original camera frame means a saved
 * file is exactly the INPUT_SIZE image the model scored: the centered square
 * crop at the scan's zoom. Best-effort like the crop: any failure returns
 * undefined and never blocks the detection result.
 */
const encodeFrame = async (): Promise<Blob | undefined> => {
  try {
    return await inputCanvas.convertToBlob({
      type: "image/jpeg",
      quality: FRAME_JPEG_QUALITY,
    });
  } catch {
    return undefined;
  }
};

const detect = async ({
  frame,
  includeFrame,
  includeThumbnail,
  includeCrop,
  zoom,
  confidenceThreshold,
}: {
  frame: ImageBitmap;
  includeFrame: boolean;
  includeThumbnail: boolean;
  includeCrop: boolean;
  zoom: number;
  confidenceThreshold: number;
}) => {
  if (!model) {
    frame.close();
    return;
  }
  try {
    const preprocessStart = performance.now();
    if (!inputContext) {
      throw new DetectionError("INFERENCE_FAILED");
    }
    const region = centerCropRegion(frame.width, frame.height, zoom);
    inputContext.drawImage(
      frame,
      region.sx,
      region.sy,
      region.side,
      region.side,
      0,
      0,
      INPUT_SIZE,
      INPUT_SIZE,
    );
    const imageData = inputContext.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
    const fingerprint = frameFingerprint(imageData);
    const brightFraction = frameBrightFraction(imageData);
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
    const decoded = decodeDetections(dets, labels, confidenceThreshold);
    // The model's boxes describe the cropped square; remap them to full-frame
    // coordinates so every consumer downstream (cropRect below, direction and
    // HUD shaping in the context) keeps one space.
    const detections = decoded.map((detection) => ({
      ...detection,
      box: mapCropBoxToFrame(detection.box, frame.width, frame.height, zoom),
    }));
    const decodeMs = performance.now() - decodeStart;

    // Cut the highest-scoring detection out of the full-resolution frame so
    // the UI can show what was detected. Best-effort: a failed cutout never
    // blocks the detection result. Skipped entirely when the detection image
    // is turned off, so a card nobody sees costs no bitmap.
    let crop: DetectionCrop | undefined;
    const topIndex = topDetectionIndex(detections);
    if (includeCrop && topIndex !== undefined) {
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

    // When the frame preview is on and there is no detection to crop, send a
    // downscaled model-input thumbnail so the contact card still shows what
    // the scan saw. A frame with a top detection sends the crop instead, so
    // the two are mutually exclusive.
    let frameThumbnail: ImageBitmap | undefined;
    if (includeThumbnail && topIndex === undefined) {
      frameThumbnail = await createFrameThumbnail();
    }

    // Model-input JPEG for frame saving, sent whenever it was asked for so the
    // card's SAVE button works beside both a crop and a frame thumbnail (a
    // missed-detection frame is exactly the kind worth saving as training
    // data).
    let savedFrame: Blob | undefined;
    if (includeFrame) {
      savedFrame = await encodeFrame();
    }

    const transfer: Transferable[] = [];
    if (crop) {
      transfer.push(crop.image);
    }
    if (frameThumbnail) {
      transfer.push(frameThumbnail);
    }
    post(
      {
        type: "detections",
        detections,
        timing: { preprocessMs, inferenceMs, decodeMs },
        crop,
        frameThumbnail,
        frame: savedFrame,
        fingerprint,
        brightFraction,
      },
      transfer,
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
  if (request.type === "probe") {
    // Answer only when the device cannot run the detector. A pass stays silent
    // and waits for `load`, which reports the backend once the session and
    // graph-capture results are known.
    void gpuProbe().then((supported) => {
      if (!supported) {
        reportUnsupported();
      }
    });
    return;
  }
  if (request.type === "load") {
    void loadModel();
    return;
  }
  void detect({
    frame: request.frame,
    includeFrame: request.includeFrame ?? false,
    includeThumbnail: request.includeThumbnail ?? false,
    includeCrop: request.includeCrop ?? true,
    zoom: request.zoom ?? ZOOM_OFF,
    confidenceThreshold: request.confidenceThreshold ?? CONFIDENCE_THRESHOLD,
  });
};
