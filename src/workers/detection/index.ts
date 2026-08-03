/// <reference lib="webworker" />
// The /webgpu subpath is deliberate: it runs WebGPU through the native C++
// WebGPU EP (asyncify runtime), not the root import's JSEP TypeScript kernels.
// JSEP has no TopK kernel, which parks this graph's TopK on the CPU EP and
// makes graph capture impossible; the native EP has one.
import { env, InferenceSession, Tensor } from "onnxruntime-web/webgpu";
import { isWebKitUa } from "@/lib/browserEngine";
import { CONFIDENCE_THRESHOLD } from "@/lib/detection";
import {
  DETECTION_MODELS,
  modelWeightsUrl,
  resolveModels,
} from "@/lib/detectionModels";
import type { DetectionModel, LoadedModel } from "@/lib/detectionModels";
import { readOnnxMetadata } from "@/lib/onnxMetadata";
import type { OnnxMetadata } from "@/lib/onnxMetadata";
import {
  CROP_MAX_EDGE,
  DEV_MODEL_CACHE_NAME,
  FRAME_JPEG_QUALITY,
  INPUT_SIZE,
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
  resolveLoadedModel,
  topDetectionIndex,
} from "./inference";
import type { DetectionCrop, WorkerResponse } from "./types";
import { DetectionError, isDetectionError, isWorkerRequest } from "./types";

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

/**
 * Everything resolved from the session graph, before the registry entry it was
 * built from is attached. The session-building helpers work in this shape so
 * only createModel has to know which model it is loading.
 */
type SessionIo = {
  session: InferenceSession;
  inputName: string;
  detsName: string;
  labelsName: string;
  /** Present when the session runs with WebGPU graph capture (gpu-buffer IO). */
  capture?: CaptureIo;
  /** Why the graph-capture attempt fell back to a plain session, if it did. */
  captureError?: string;
  /**
   * Shape of the `labels` output this session's first run produced. Both load
   * paths run the model once before reporting ready (the capture path to
   * perform the capture, the plain path to warm the shaders up), so the real
   * head width is available without a run of its own.
   */
  labelsDims: readonly number[];
};

/** Names discovered from the session graph, resolved at load time. */
type ModelIo = Omit<SessionIo, "labelsDims"> & {
  /**
   * The registry entry this session was built from: its URL and class table,
   * reconciled with the head width the session reported.
   */
  detectionModel: LoadedModel;
  /**
   * What the weights file said about itself, for the backend probe. Undefined
   * when the bytes did not parse as a model, which nothing here treats as a
   * failure: a session that runs is a session that runs.
   */
  fileMetadata?: OnnxMetadata;
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
 * megabytes per reload.
 *
 * The entry is keyed on the revision-pinned URL, so a revision bump misses and
 * re-downloads. Entries that no registered model names any more (old revisions)
 * are evicted, while a model a developer is switching between keeps its
 * weights, so flipping back does not pay for the download twice.
 *
 * No-op in production builds and best-effort in dev: any failure just means a
 * re-download on the next launch.
 */
const cacheModelInDev = async (
  url: string,
  weights: Uint8Array<ArrayBuffer>,
) => {
  if (!import.meta.env.DEV || !("caches" in self)) {
    return;
  }
  try {
    const cache = await caches.open(DEV_MODEL_CACHE_NAME);
    const current = new Set(DETECTION_MODELS.map(modelWeightsUrl));
    for (const request of await cache.keys()) {
      if (!current.has(request.url)) {
        await cache.delete(request);
      }
    }
    await cache.put(url, new Response(weights));
  } catch {
    // Dev convenience only; never let a cache failure affect the load.
  }
};

/** Resolve the graph's input/output names from a freshly created session. */
const resolveIoNames = (
  session: InferenceSession,
): Pick<SessionIo, "inputName" | "detsName" | "labelsName"> => {
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
 * not always fail at session creation) while the caller can still fall back to
 * a plain session. Throws on any failure after releasing whatever was created.
 *
 * `onSessionCreated` fires the instant the session exists, which is the point
 * the caller's copy of the weights stops being needed (see `createModel`).
 */
const createCaptureModel = async (
  weights: Uint8Array,
  onSessionCreated: () => void,
): Promise<SessionIo> => {
  const session = await InferenceSession.create(weights, {
    executionProviders: ["webgpu"],
    enableGraphCapture: true,
    preferredOutputLocation: "gpu-buffer",
  });
  onSessionCreated();
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
    // Read before getData(), which downloads the data and releases the
    // GPU-side output.
    const labelsDims = outputs[io.labelsName].dims;
    await outputs[io.detsName].getData(true);
    await outputs[io.labelsName].getData(true);
    return {
      session,
      ...io,
      labelsDims,
      capture: { device, inputGpuBuffer, inputTensor },
    };
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

/**
 * Run a plain session once on the (still zeroed) input buffer before reporting
 * it ready. The first run of a WebGPU session is the heaviest moment the GPU
 * process sees all session: it compiles the model's hundreds of WGSL shaders
 * and allocates every intermediate buffer at once. Without this it lands on the
 * driver's first scanned frame, concurrent with a live camera stream, the frame
 * pump, and the meter's rAF loop, which is exactly where the field crashes
 * cluster (DASHRADAR-2: every kill inside ~21 s of scanning, four of them
 * before a single detection result came back). Warming up moves that peak to a
 * quiet moment when nothing else is running and no frame is riding on it.
 *
 * The capture path already gets this for free: `createCaptureModel`'s first run
 * performs the capture and doubles as the same warm-up. This is what gives the
 * fallback path parity.
 *
 * Failure propagates rather than being swallowed. A session that cannot run
 * once on zeroed input cannot detect anything, so surfacing it here as
 * MODEL_LOAD_FAILED (with the reason on the backend probe) reports the same
 * outcome the first real frame would have produced, only sooner and named more
 * accurately than a per-frame INFERENCE_FAILED.
 *
 * Returns the run's `labels` shape, which is where the plain path gets the head
 * width the capture path reads off its capture run.
 */
const warmUpSession = async (
  io: Omit<SessionIo, "labelsDims">,
): Promise<readonly number[]> => {
  const input = new Tensor("float32", inputBuffer, [
    1,
    3,
    INPUT_SIZE,
    INPUT_SIZE,
  ]);
  const outputs = await io.session.run({ [io.inputName]: input });
  return outputs[io.labelsName].dims;
};

/**
 * Download and instantiate the WebGPU session.
 *
 * The weights buffer is dropped as soon as a session has copied it into ORT's
 * own heap, rather than being held until this function returns. That matters
 * because what follows session creation is the first run (the capture run, or
 * `warmUpSession`), which compiles the model's shaders and allocates every
 * intermediate at once. Keeping the ~57 MB JS buffer reachable across that
 * instant stacks a redundant copy onto the highest peak of the whole session,
 * on a platform that kills the page for crossing its budget with no warning.
 *
 * Only a cache-backed load releases, because only it can hand the bytes back
 * for free: the capture fallback below re-matches the very CacheStorage entry
 * this read came from. A fresh download has no such second source, so it keeps
 * the buffer across the first run exactly as before rather than risk paying for
 * 57 MB twice. That costs nothing in practice for a driving session: a first
 * visit loads once, while every worker recycle after it reads from cache and so
 * takes the releasing path.
 */
const createModel = async (
  detectionModel: DetectionModel,
): Promise<ModelIo> => {
  const url = modelWeightsUrl(detectionModel);
  const cached = await matchCachedModel(url);
  // Tell the context whether this is a network download so it can show the
  // download-progress screen only when we are actually downloading, not when
  // reading already-cached weights (a cache read still takes a beat to compile
  // the ONNX session, which otherwise flashes a misleading "downloading" UI).
  post({ type: "model-load-start", fromCache: cached !== undefined });
  let weights: Uint8Array<ArrayBuffer> | undefined;
  if (cached) {
    weights = new Uint8Array(await cached.arrayBuffer());
  } else {
    const downloadStartedAt = performance.now();
    weights = await fetchModel(url);
    // Report the completed download before the session is built from it, so a
    // device that downloads the weights but then fails session creation still
    // counts as a successful download.
    post({
      type: "model-downloaded",
      durationMs: performance.now() - downloadStartedAt,
    });
    await cacheModelInDev(url, weights);
  }
  // Read the file's own metadata before a session is built from it, because
  // the capture path hands the buffer back the moment ORT has copied it.
  // Costs a few dozen varint reads: the graph is stepped over by length, never
  // parsed, so file size does not enter into it.
  const fileMetadata = readOnnxMetadata(weights);
  const releaseWeights = () => {
    if (cached) {
      weights = undefined;
    }
  };
  let captureError: string | undefined;
  let io: SessionIo | undefined;
  // WebKit never attempts capture: measured iPhone round trips are the same
  // with capture on or off, so the replay buys nothing there to weigh against
  // its instability risk (see the WEBGPU_GRAPH_CAPTURE doc in consts.ts).
  if (WEBGPU_GRAPH_CAPTURE && !isWebKitUa(navigator.userAgent)) {
    try {
      io = await createCaptureModel(weights, releaseWeights);
    } catch (error) {
      // Capture may not work on this device or export; fall back to a plain
      // WebGPU session and record why for the debug overlay.
      captureError = describeError(error);
    }
  }
  if (!io) {
    if (!weights) {
      // The capture attempt released the buffer after building its session, so
      // re-read the entry it came from. Guaranteed present: this same cache was
      // matched moments ago, and the miss branch never releases.
      const entry = await matchCachedModel(url);
      if (!entry) {
        throw new DetectionError("MODEL_LOAD_FAILED");
      }
      weights = new Uint8Array(await entry.arrayBuffer());
    }
    const session = await InferenceSession.create(weights, {
      executionProviders: ["webgpu"],
    });
    releaseWeights();
    const plain = { session, ...resolveIoNames(session), captureError };
    io = { ...plain, labelsDims: await warmUpSession(plain) };
  }
  // Reconciled once, after whichever path built the session, so a head width
  // the entry disagrees with cannot send the capture path into a pointless
  // fallback that builds a second session only to fail the same way.
  const { labelsDims, ...rest } = io;
  return {
    ...rest,
    fileMetadata,
    detectionModel: resolveLoadedModel(
      labelsDims,
      detectionModel,
      fileMetadata,
    ),
  };
};

/**
 * Report the WebGPU device backing the session being lost, for as long as this
 * worker lives. WebKit runs WebGPU in its own GPU process, so that process
 * dying takes the device out from under an otherwise healthy page; the app
 * would otherwise notice a frame later, as a generic INFERENCE_FAILED, and once
 * per frame after that. Naming it is the point: a GPU-process death reports
 * something, while the OS killing the whole page reports nothing at all (no JS
 * runs), so the two finally look different in telemetry.
 *
 * `device.lost` resolves at most once and never in a healthy session, so the
 * await simply parks until termination. A "destroyed" reason means something
 * deliberately tore the device down rather than losing it, so it is not a
 * failure to report; nothing in this worker destroys the session device, but
 * the probe destroys its own by design.
 */
const watchDeviceLoss = async () => {
  try {
    const device = await env.webgpu.device;
    if (!device) {
      return;
    }
    const { reason, message } = await device.lost;
    if (reason === "destroyed") {
      return;
    }
    post({
      type: "worker-error",
      code: "GPU_DEVICE_LOST",
      detail: `${reason}: ${message}`,
    });
  } catch {
    // No device exposed to watch. The session still runs; a real loss just
    // surfaces per frame as INFERENCE_FAILED, exactly as it did before.
  }
};

const loadModel = async (modelId: string | undefined) => {
  if (!(await gpuProbe())) {
    reportUnsupported();
    return;
  }
  // An omitted or unrecognized id resolves to the shipping model, so a stale
  // selection loads something rather than failing.
  const [detectionModel] = resolveModels(
    modelId === undefined ? [] : [modelId],
  );
  try {
    model = await createModel(detectionModel);
    // Watch only once the session exists, so the device being resolved is the
    // one the backend actually runs on.
    void watchDeviceLoss();
    post({
      type: "backend-probe",
      probe: {
        ...wasmRuntime,
        graphCapture: model.capture !== undefined,
        graphCaptureError: model.captureError,
        modelFile: model.fileMetadata,
      },
    });
    post({ type: "ready", classes: model.detectionModel.classes });
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
    const decoded = decodeDetections(
      dets,
      labels,
      confidenceThreshold,
      model.detectionModel,
    );
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
  } catch (error) {
    // A DetectionError carries the real cause (a head-width mismatch reports
    // MODEL_LOAD_FAILED, since the loaded model is wrong for this build rather
    // than the inference having failed). Anything else is a genuine inference
    // fault.
    post({
      type: "worker-error",
      code: isDetectionError(error) ? error.code : "INFERENCE_FAILED",
    });
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
    void loadModel(request.modelId);
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
