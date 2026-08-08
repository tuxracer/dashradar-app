/**
 * What every checkpoint shares about being run here; the checkpoints themselves
 * are in src/lib/detectionModels.
 *
 * Raw onnxruntime-web rather than the Transformers.js `pipeline()`, whose DETR
 * post-processor assumes a softmax head with a background class and drops every
 * detection off this sigmoid one.
 *
 * The weights are mixed-precision fp16 on WebGPU, needing the `shader-f16`
 * feature `probeWebGpu` gates on; inputs and outputs stay fp32. There is
 * deliberately no CPU fallback, which measured round trips over 10 s against
 * WebGPU's 500 ms and only looked like a working detector.
 */

/**
 * Where the worker caches weights on the dev server, which has no service worker
 * to do it. Keyed per model on its revision-pinned URL, so switching between two
 * models evicts neither and a bumped revision misses and re-downloads. Unused in
 * production.
 */
export const DEV_MODEL_CACHE_NAME = "model-cache-dev";

/**
 * Attempt a WebGPU session with `enableGraphCapture` before falling back to a
 * plain one. Requires the native C++ WebGPU EP: the root import's JSEP registry
 * has no TopK kernel, so this graph's TopK lands on CPU and fails capture's
 * all-nodes-partitioned check everywhere.
 *
 * Attempted on every engine, WebKit included, though it buys no round trip there
 * unlike the large Chromium Android win. Don't reintroduce a WebKit skip; the
 * sentinel's `graphCapture` tag is what would show a correlation if one appears.
 */
export const WEBGPU_GRAPH_CAPTURE = true;

/** Square input edge the model expects (NCHW `[1,3,512,512]`). */
export const INPUT_SIZE = 512;

/**
 * Crop factor the 2x zoom applies: half the field of view into the same input
 * grid. A fixed step rather than a range, because native camera zoom is missing
 * on iOS Safari and device-defined on Chrome Android. CAMERA_CONSTRAINTS requests
 * twice the input edge, so this lands at 512 native with no upsampling.
 */
export const ZOOM_2X = 2;

/** Crop factor when the 2x zoom is off: the full centered square. */
export const ZOOM_OFF = 1;

/** ImageNet channel means (R, G, B) used to normalize the input. */
export const IMAGENET_MEAN: readonly [number, number, number] = [
  0.485, 0.456, 0.406,
];

/** ImageNet channel standard deviations (R, G, B) used to normalize the input. */
export const IMAGENET_STD: readonly [number, number, number] = [
  0.229, 0.224, 0.225,
];

/**
 * Ceiling on onnxruntime-web's wasm threads. Inference runs on the GPU, but the
 * runtime hosting the provider is itself wasm and runs any node it cannot take.
 * Past a phone's few performance cores threads land on efficiency ones and make
 * the fast cores wait. Needs cross-origin isolation to take effect at all.
 */
export const WASM_THREAD_CAP = 4;

/**
 * Fraction of the detection box's own width/height added as context on each
 * side of the contact cutout, so the crop shows a little road around the
 * vehicle instead of a tight box.
 */
export const CROP_PADDING = 0.15;

/**
 * Longest edge, in pixels, of the cutout ImageBitmap transferred back with a
 * detections result. Bounds transfer size and retained memory; crops smaller
 * than this are never upscaled.
 */
export const CROP_MAX_EDGE = 320;
