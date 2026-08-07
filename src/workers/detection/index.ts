/// <reference lib="webworker" />
// The /webgpu subpath is deliberate: it runs the native C++ WebGPU EP rather
// than the root import's JSEP kernels, which have no TopK and so park this
// graph's TopK on CPU, making graph capture impossible.
import { env, InferenceSession, Tensor } from "onnxruntime-web/webgpu";
import { CONFIDENCE_THRESHOLD } from "@/lib/detection";
import {
  BUILT_IN_MODELS,
  DEFAULT_MODEL,
  modelWeightsUrl,
} from "@/lib/detectionModels";
import type { DetectionModel, LoadedModel } from "@/lib/detectionModels";
import { readOnnxMetadata } from "@/lib/onnxMetadata";
import type { OnnxMetadata } from "@/lib/onnxMetadata";
import { compareScenes, sceneSignature } from "@/lib/sceneChange";
import type { SceneSignature } from "@/lib/sceneChange";
import {
  DEV_MODEL_CACHE_NAME,
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
  mapCropBoxToFrame,
  preprocess,
  resolveLoadedModel,
  topDetectionIndex,
} from "./inference";
import type { DetectionCrop, WorkerResponse } from "./types";
import { DetectionError, isDetectionError, isWorkerRequest } from "./types";
import { installWasmMemoryCapture, wasmHeapBytes } from "./wasmMemory";

declare const self: DedicatedWorkerGlobalScope;

// Same-origin (served at /ort/ by the ortRuntime Vite plugin) rather than a CDN,
// so cross-origin isolation does not block it and there is no live dependency.
env.wasm.wasmPaths = `${import.meta.env.BASE_URL}ort/`;

// Must run before the runtime instantiates; see ./wasmMemory.
installWasmMemoryCapture();

// Callable by hand from a tethered Web Inspector, so the heap can be polled
// between scans without waiting for the next reply to carry it.
Object.assign(self, { dashradarWasmHeapBytes: wasmHeapBytes });

/** ORT wasm-runtime thread count for this device, capped for big.LITTLE. */
const wasmThreads = Math.min(
  navigator.hardwareConcurrency || WASM_THREAD_CAP,
  WASM_THREAD_CAP,
);
env.wasm.numThreads = wasmThreads;

/**
 * State for a graph-capture session. A capture session rejects CPU-located input
 * tensors at run(), so each frame is written into one persistent GPU buffer and
 * the session always sees the same `Tensor.fromGpuBuffer` wrapper.
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
   * paths run once before reporting ready, so the real head width is available
   * without a run of its own.
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

// Reused across frames to keep the hot path allocation-free; a canvas and a
// ~3 MB tensor per frame otherwise produce steady GC jank on mobile. Safe to
// share because only one frame is ever in flight. `willReadFrequently` keeps the
// canvas CPU-backed so the per-frame getImageData readback stays cheap.
const inputCanvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
const inputContext = inputCanvas.getContext("2d", { willReadFrequently: true });
const inputBuffer = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);

/**
 * Tile signature of the frame the model last actually ran on, the scene-change
 * gate's baseline. The last *scanned* frame rather than the last frame seen:
 * against its immediate predecessor a scene that creeps could drift arbitrarily
 * far without any single step clearing the threshold, while this way the drift
 * stays on the books until something crosses it. Undefined until a worker's
 * first scan, so a fresh or recycled one always runs the model before it skips.
 */
let lastScanned: SceneSignature | undefined;

const post = (message: WorkerResponse, transfer: Transferable[] = []) => {
  self.postMessage(message, transfer);
};

/** wasm-runtime facts reported alongside every session result. */
const wasmRuntime = {
  crossOriginIsolated: self.crossOriginIsolated,
  threads: wasmThreads,
};

/**
 * Whether this device can run the detector, decided by actually acquiring a
 * device rather than checking the API exists: `navigator.gpu` is sometimes
 * present where no adapter can be obtained, and the API check alone would
 * download tens of megabytes only to fail at session creation. The adapter must
 * also expose `shader-f16`, which onnxruntime-web requires for any fp16 tensor
 * in the graph.
 *
 * Failure at any stage is terminal, with no CPU path left to fall back to. Runs
 * in the worker scope, where onnxruntime-web needs WebGPU: some browsers expose
 * `navigator.gpu` on the main thread but not inside a worker.
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
 * Look for an already-cached copy of the weights, written by the Workbox
 * "model-cache" route in production and by cacheModelInDev otherwise. A hit
 * means the load is not a network download, so the UI skips the progress screen.
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
 * Stream the weights over the network, reporting byte progress. Chunks land
 * directly in one buffer preallocated from Content-Length rather than being
 * accumulated and copied at the end, which would briefly hold two copies right
 * before InferenceSession.create makes a third and risk an OOM on a low-RAM
 * phone. ensureCapacity grows the buffer when Content-Length is missing or
 * understates the body, so the copy-free path is an optimization only.
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
 * Cache freshly downloaded weights on the dev server, which has no service
 * worker to do it, so later launches skip re-downloading tens of megabytes.
 * Everything but the built-ins and the model being loaded is evicted, so
 * flipping between two added models re-downloads one of them. No-op in
 * production, best-effort in dev: a failure only costs a re-download.
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
    const keep = new Set([...BUILT_IN_MODELS.map(modelWeightsUrl), url]);
    for (const request of await cache.keys()) {
      if (!keep.has(request.url)) {
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
 * Create a WebGPU session with graph capture, which records the model's kernel
 * dispatches on the first run and replays them after, cutting the CPU cost of
 * dispatching RF-DETR's hundreds of small kernels. A capture session accepts
 * only GPU-located IO, hence the persistent input buffer and `gpu-buffer`
 * outputs read back with `getData(true)`.
 *
 * The first run performs the capture, doubles as shader warm-up, and surfaces
 * run-time capture incompatibility (which does not always fail at session
 * creation) while the caller can still fall back. `onSessionCreated` fires the
 * instant the caller's copy of the weights stops being needed.
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
    // From ORT after session creation, so the buffer lands on the same
    // GPUDevice the backend runs on.
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
 * Run a plain session once on the zeroed input before reporting it ready, giving
 * the fallback path the warm-up the capture path gets from its capture run. A
 * WebGPU session's first run compiles hundreds of WGSL shaders and allocates
 * every intermediate at once; unwarmed, that peak lands on the first scanned
 * frame alongside a live camera stream and the frame pump, which is where the
 * field crashes clustered. Failure propagates: a session that cannot run on
 * zeroed input cannot detect anything, and MODEL_LOAD_FAILED names that better
 * than a per-frame INFERENCE_FAILED would. Returns the run's `labels` shape.
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
 * The weights buffer is dropped the moment ORT has copied it, not when this
 * function returns, because the first run follows immediately and is the
 * session's highest memory peak. Holding a redundant copy across it is what
 * kills the page on a platform with no warning before the budget.
 *
 * The release only happens once CacheStorage is confirmed to hold the bytes,
 * since the capture fallback below re-reads that entry. A cache read confirms
 * itself; a fresh download is confirmed by re-matching afterwards, which usually
 * hits because the download seeds the cache on its way through. That covers the
 * first visit, which is where it matters most. On a miss the buffer is the only
 * copy and is kept across the first run.
 */
const createModel = async (
  detectionModel: DetectionModel,
): Promise<ModelIo> => {
  const url = modelWeightsUrl(detectionModel);
  const cached = await matchCachedModel(url);
  // A cache read still takes a beat to compile the session, which would flash a
  // misleading "downloading" screen without this.
  post({ type: "model-load-start", fromCache: cached !== undefined });
  let weights: Uint8Array<ArrayBuffer> | undefined;
  let inCacheStorage = cached !== undefined;
  if (cached) {
    weights = new Uint8Array(await cached.arrayBuffer());
  } else {
    const downloadStartedAt = performance.now();
    weights = await fetchModel(url);
    // Before the session is built, so a device that downloads the weights and
    // then fails session creation still counts as a successful download.
    post({
      type: "model-downloaded",
      durationMs: performance.now() - downloadStartedAt,
    });
    await cacheModelInDev(url, weights);
    // A miss is not an error; it only means this buffer is the sole copy, so
    // releaseWeights must keep it.
    inCacheStorage = (await matchCachedModel(url)) !== undefined;
  }
  // Before a session is built, because the capture path hands the buffer back
  // the moment ORT has copied it. The graph is stepped over by length rather
  // than parsed, so this costs a few dozen varint reads whatever the file size.
  const fileMetadata = readOnnxMetadata(weights);
  const releaseWeights = () => {
    if (inCacheStorage) {
      weights = undefined;
    }
  };
  let captureError: string | undefined;
  let io: SessionIo | undefined;
  if (WEBGPU_GRAPH_CAPTURE) {
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
      // The capture attempt released the buffer, so re-read the entry it came
      // from; present by construction, since a release needs a confirmed match.
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
  // Reconciled once, after whichever path built the session, so a disagreeing
  // head width cannot send the capture path into a fallback that builds a
  // second session only to fail the same way.
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
 * Report the session's WebGPU device being lost. WebKit runs WebGPU in its own
 * process, so that process dying takes the device out from under a healthy page,
 * which the app would otherwise notice a frame later as a generic
 * INFERENCE_FAILED, once per frame. Naming it is the point: a GPU-process death
 * reports something while an OS kill reports nothing, so telemetry can finally
 * tell them apart. A "destroyed" reason is a deliberate teardown, not a failure.
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
      reason,
    });
  } catch {
    // No device exposed to watch; a real loss still surfaces per frame as
    // INFERENCE_FAILED.
  }
};

const loadModel = async (requested: DetectionModel | undefined) => {
  // A different model reads the same road differently, so what the previous one
  // had already looked at says nothing about what this one still needs to.
  lastScanned = undefined;
  if (!(await gpuProbe())) {
    reportUnsupported();
    return;
  }
  // An omitted entry means the build's default, so a stale caller loads
  // something rather than failing.
  const detectionModel = requested ?? DEFAULT_MODEL;
  try {
    model = await createModel(detectionModel);
    // Only once the session exists, so the device resolved is the one the
    // backend actually runs on.
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
    post({
      type: "ready",
      loaded: {
        headWidth: model.detectionModel.headWidth,
        classes: model.detectionModel.classes,
      },
      wasmHeapBytes: wasmHeapBytes(),
    });
  } catch (error) {
    // The probe acquired a device but the session still failed to build. No
    // second backend to try, so this is terminal; record why for the overlay.
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

const detect = async ({
  frame,
  includeCrop,
  zoom,
  source,
  confidenceThreshold,
  forceScan,
}: {
  frame: ImageBitmap;
  includeCrop: boolean;
  zoom: number;
  source?: { width: number; height: number };
  confidenceThreshold: number;
  forceScan: boolean;
}) => {
  if (!model) {
    frame.close();
    return;
  }
  // Above the try so the catch can reach it: a crop only leaves this
  // function's ownership when the post delivers it.
  let crop: DetectionCrop | undefined;
  try {
    const preprocessStart = performance.now();
    if (!inputContext) {
      throw new DetectionError("INFERENCE_FAILED");
    }
    // The frame the boxes must end up normalized against. A pre-cropped frame
    // no longer carries those dimensions itself, so its sender supplies them.
    const frameSize = source ?? { width: frame.width, height: frame.height };
    if (source) {
      // Already the centered square, so scale the whole bitmap on rather than
      // cropping again. Scaled rather than blitted 1:1 because
      // createImageBitmap's resize options are a request a platform may ignore,
      // leaving a full-size crop; an honored resize makes this a straight copy.
      inputContext.drawImage(
        frame,
        0,
        0,
        frame.width,
        frame.height,
        0,
        0,
        INPUT_SIZE,
        INPUT_SIZE,
      );
    } else {
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
    }
    const imageData = inputContext.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);

    // The scene-change gate, between the readback and the work worth avoiding. A
    // car at a light spends minutes pointing the camera at a picture that does
    // not move, and nothing can enter the frame without changing the pixels in
    // it, so a pass over bytes already in hand buys skipping both the
    // normalization and the inference. After the draw rather than before it, so
    // the comparison runs on the same pixels, in the same geometry, the model
    // would have read.
    const gateStart = performance.now();
    const signature = sceneSignature(imageData);
    const scene = lastScanned
      ? compareScenes(lastScanned, signature)
      : undefined;
    const gateMs = performance.now() - gateStart;
    if (!forceScan && scene && !scene.changed) {
      // The baseline stays put: advancing it per skip would restart the drift
      // measurement each time, so a scene changing slower than the threshold per
      // frame would never accumulate enough to trip the gate.
      post({
        type: "scan-skipped",
        gateMs,
        delta: scene.delta,
        wasmHeapBytes: wasmHeapBytes(),
      });
      return;
    }
    lastScanned = signature;

    const inputData = preprocess(imageData, inputBuffer);
    const preprocessMs = performance.now() - preprocessStart;

    // getData(true) both downloads the data and releases the GPU-side output, so
    // the capture path's inference time includes the readback sync point, the
    // same thing the plain path's run() already includes.
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
    // coordinates so everything downstream keeps one space.
    const detections = decoded.map((detection) => ({
      ...detection,
      box: mapCropBoxToFrame(
        detection.box,
        frameSize.width,
        frameSize.height,
        zoom,
      ),
    }));
    const decodeMs = performance.now() - decodeStart;

    // Cut the top detection out of the full-resolution frame for the contact
    // card. Best-effort, and skipped when the card is off so a bitmap nobody
    // sees is never made. Never cut from a pre-cropped frame: the boxes are
    // normalized to the whole video frame while the bitmap holds only the zoom
    // crop, so the rect would land somewhere else. Senders already withhold the
    // pre-crop when a cutout is wanted; this keeps a drift from showing a wrong
    // picture rather than no picture.
    const topIndex = topDetectionIndex(detections);
    if (includeCrop && !source && topIndex !== undefined) {
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

    const transfer: Transferable[] = [];
    if (crop) {
      transfer.push(crop.image);
    }
    post(
      {
        type: "detections",
        detections,
        timing: { preprocessMs, inferenceMs, decodeMs },
        crop,
        sceneDelta: scene?.delta,
        wasmHeapBytes: wasmHeapBytes(),
      },
      transfer,
    );
  } catch (error) {
    // Landing here means the crop was never delivered, so it is still this
    // function's to close; closing an already-detached bitmap is a no-op, so a
    // post that failed after transferring stays safe.
    crop?.image.close();
    // A DetectionError carries the real cause: a head-width mismatch is a wrong
    // model, not a failed inference.
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
    // A malformed detect request still carries its transferred frame, and this
    // rejection is its last owner. Nothing well-typed sends one today, but a
    // newer page posting to an older precached worker would leak a
    // full-resolution bitmap per scan.
    if (
      typeof request === "object" &&
      request !== null &&
      "frame" in request &&
      request.frame instanceof ImageBitmap
    ) {
      request.frame.close();
    }
    return;
  }
  if (request.type === "probe") {
    // Answer only on failure. A pass stays silent and waits for `load`, which
    // reports the backend once the session and capture results are known.
    void gpuProbe().then((supported) => {
      if (!supported) {
        reportUnsupported();
      }
    });
    return;
  }
  if (request.type === "load") {
    void loadModel(request.model);
    return;
  }
  void detect({
    frame: request.frame,
    includeCrop: request.includeCrop ?? true,
    zoom: request.zoom ?? ZOOM_OFF,
    source: request.source,
    confidenceThreshold: request.confidenceThreshold ?? CONFIDENCE_THRESHOLD,
    forceScan: request.forceScan ?? false,
  });
};
