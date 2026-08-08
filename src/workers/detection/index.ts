/// <reference lib="webworker" />
// The /webgpu subpath is deliberate: the root import's JSEP kernels have no
// TopK, which parks this graph's TopK on CPU and makes graph capture impossible.
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

// Same-origin rather than a CDN, so cross-origin isolation does not block it.
env.wasm.wasmPaths = `${import.meta.env.BASE_URL}ort/`;

// Must run before the runtime instantiates; see ./wasmMemory.
installWasmMemoryCapture();

// Callable by hand from a tethered Web Inspector, to poll between scans.
Object.assign(self, { dashradarWasmHeapBytes: wasmHeapBytes });

/** ORT wasm-runtime thread count for this device, capped for big.LITTLE. */
const wasmThreads = Math.min(
  navigator.hardwareConcurrency || WASM_THREAD_CAP,
  WASM_THREAD_CAP,
);
env.wasm.numThreads = wasmThreads;

/**
 * State for a graph-capture session, which rejects CPU-located input tensors at
 * run(), so each frame is written into one persistent GPU buffer.
 */
type CaptureIo = {
  device: GPUDevice;
  inputGpuBuffer: GPUBuffer;
  inputTensor: Tensor;
};

/**
 * Everything resolved from the session graph, before its registry entry is
 * attached, so only createModel has to know which model is loading.
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
  /** Shape of the `labels` output the session's first run produced. */
  labelsDims: readonly number[];
};

/** Names discovered from the session graph, resolved at load time. */
type ModelIo = Omit<SessionIo, "labelsDims"> & {
  /** The registry entry, reconciled with the head width the session reported. */
  detectionModel: LoadedModel;
  /**
   * What the weights said about themselves, for the backend probe. Undefined when
   * the bytes did not parse, which is not a failure: a session that runs, runs.
   */
  fileMetadata?: OnnxMetadata;
};

let model: ModelIo | undefined;

// Reused across frames to keep the hot path allocation-free; a ~3 MB tensor per
// frame is steady GC jank on mobile. Safe because only one frame is in flight.
// `willReadFrequently` keeps the getImageData readback cheap.
const inputCanvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
const inputContext = inputCanvas.getContext("2d", { willReadFrequently: true });
const inputBuffer = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);

/**
 * The gate's baseline: the last *scanned* frame, not the last frame seen. Against
 * its immediate predecessor a creeping scene could drift arbitrarily far without
 * any single step clearing the threshold. Undefined until a worker's first scan.
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
 * Whether this device can run the detector, decided by acquiring a device rather
 * than checking the API exists: `navigator.gpu` is sometimes present where no
 * adapter can be obtained, and the check alone would download tens of megabytes
 * only to fail at session creation. `shader-f16` is required for the fp16 graph.
 * Runs in the worker scope, where some browsers do not expose `navigator.gpu`.
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
 * The one probe this worker runs. Acquiring a device is not free, and `load` must
 * see the verdict `probe` reported rather than re-deciding.
 */
let gpuProbeResult: Promise<boolean> | undefined;
const gpuProbe = (): Promise<boolean> => (gpuProbeResult ??= probeWebGpu());

/** Idempotent: both handlers reach it, and the terminal error must fire once. */
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
 * Look for an already-cached copy of the weights. A hit means the load is not a
 * network download, so the UI skips the progress screen.
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
 * Stream the weights, reporting byte progress. Chunks land in one buffer
 * preallocated from Content-Length: accumulating and copying at the end would
 * hold two copies right before InferenceSession.create makes a third, which is
 * an OOM on a low-RAM phone. ensureCapacity covers a missing Content-Length.
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
  // A subarray, not a slice: a slice recreates the peak this avoids.
  return loaded === buffer.byteLength ? buffer : buffer.subarray(0, loaded);
};

/**
 * Cache weights on the dev server, which has no service worker to do it.
 * Everything but the built-ins and the loading model is evicted, so flipping
 * between two added models re-downloads one. No-op in production.
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
 * Create a session with graph capture, which records the kernel dispatches on the
 * first run and replays them after. Capture accepts only GPU-located IO, hence
 * the persistent input buffer and `getData(true)` readback.
 *
 * The first run performs the capture, doubles as warm-up, and surfaces run-time
 * incompatibility while the caller can still fall back. `onSessionCreated` fires
 * the instant the caller's copy of the weights stops being needed.
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
    await Promise.all([
      outputs[io.detsName].getData(true),
      outputs[io.labelsName].getData(true),
    ]);
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
 * Warm a plain session before reporting it ready, which the capture path gets
 * from its capture run. A first run compiles hundreds of shaders and allocates
 * every intermediate at once; unwarmed, that peak lands on the first scanned
 * frame alongside a live camera stream. Failure propagates, since a session that
 * cannot run on zeroed input cannot detect anything.
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
 * returns, because the first run follows immediately and is the session's highest
 * memory peak. Releasing needs CacheStorage confirmed to hold the bytes, since
 * the capture fallback re-reads that entry; on a miss the buffer is the only copy
 * and is kept across the first run.
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
  // Before a session is built, because the capture path hands the buffer back at
  // once. The graph is stepped over by length, so this costs a few varint reads.
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
  // Once, after whichever path built the session, so a disagreeing head width
  // cannot send the capture path into a fallback that fails the same way.
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
 * Report the session's WebGPU device being lost, which WebKit can do by killing
 * its GPU process under a healthy page. Naming it is the point: otherwise it
 * arrives a frame later as a generic INFERENCE_FAILED, once per frame, and
 * telemetry cannot tell it from an OS kill. "destroyed" is a deliberate teardown.
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
  // A different model reads the same road differently.
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

    // The gate, between the readback and the work worth avoiding: nothing can
    // enter the frame without changing the pixels in it, so a pass over bytes
    // already in hand buys skipping the normalization and the inference. After
    // the draw, so it runs on the same pixels the model would have read.
    const gateStart = performance.now();
    const signature = sceneSignature(imageData);
    const scene = lastScanned
      ? compareScenes(lastScanned, signature)
      : undefined;
    const gateMs = performance.now() - gateStart;
    if (!forceScan && scene && !scene.changed) {
      // The baseline stays put: advancing it per skip restarts the drift
      // measurement, so a slow change never accumulates enough to trip.
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

    // getData(true) downloads and releases the output, so this timing includes
    // the readback sync point that run() already includes on the plain path.
    const inferenceStart = performance.now();
    let dets: Float32Array;
    let labels: Float32Array;
    if (model.capture) {
      const { device, inputGpuBuffer, inputTensor } = model.capture;
      device.queue.writeBuffer(inputGpuBuffer, 0, inputData);
      const outputs = await model.session.run({
        [model.inputName]: inputTensor,
      });
      const [detsData, labelsData] = await Promise.all([
        outputs[model.detsName].getData(true),
        outputs[model.labelsName].getData(true),
      ]);
      dets = detsData as Float32Array;
      labels = labelsData as Float32Array;
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

    // The contact card's cutout. Best-effort, and skipped when the card is off so
    // a bitmap nobody sees is never made. Never from a pre-cropped frame: the
    // boxes are normalized to the whole video frame, so the rect would land
    // somewhere else. Senders withhold the pre-crop when a cutout is wanted.
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
    // The crop was never delivered, so it is still this function's to close;
    // closing an already-detached bitmap is a no-op.
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
    // A malformed request still carries its transferred frame and this is its
    // last owner. A newer page posting to an older precached worker would
    // otherwise leak a bitmap per scan.
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
