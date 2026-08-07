/**
 * What every checkpoint shares about being run here; the checkpoints themselves
 * are in src/lib/detectionModels.
 *
 * Raw onnxruntime-web rather than the Transformers.js `pipeline()` path: the
 * pipeline's DETR post-processor assumes a softmax head with a background class
 * and takes the arg-max label per query, while this head is sigmoid scored per
 * class with an unused slot at index 0, so it reads the logits wrong and drops
 * every detection.
 *
 * The weights are mixed-precision fp16 on WebGPU, which needs the `shader-f16`
 * feature `probeWebGpu` gates on. The two GridSample nodes stay fp32 because a
 * pure-fp16 GridSample produced garbage under the old JSEP path; inputs and
 * outputs are fp32 either way, so preprocess and decode are unaffected.
 *
 * There is deliberately no CPU fallback. The int8 build that used to serve it
 * measured round trips over 10 s where WebGPU takes about 500 ms, so a device
 * without usable WebGPU is turned away rather than handed a detector that looks
 * like it works and does not.
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
 * plain one. It requires the native C++ WebGPU EP, since the root import's JSEP
 * registry has no TopK kernel and parks this graph's TopK on CPU, failing
 * capture's all-nodes-partitioned check everywhere.
 *
 * Attempted on every engine, WebKit included, though it buys no round trip
 * there (measured on an iPhone 16e) unlike the large Chromium Android win.
 * WebKit was excluded twice and both exclusions were retired: the crash
 * attribution was disproved when iOS kills landed with capture on and off
 * alike, and the measured no-win did not justify a user-agent branch guarding
 * against nothing observed. The crash sentinel's `graphCapture` tag is what
 * would show a correlation if one ever appears.
 */
export const WEBGPU_GRAPH_CAPTURE = true;

/** Square input edge the model expects (NCHW `[1,3,512,512]`). */
export const INPUT_SIZE = 512;

/**
 * Crop factor the 2x zoom applies: half the field of view into the same input
 * grid, so a distant vehicle occupies twice the linear size. A fixed step rather
 * than a range because native camera zoom is missing on iOS Safari and reports
 * device-defined units on Chrome Android, so cropping ourselves is the only way
 * one setting means the same thing on both. CAMERA_CONSTRAINTS requests roughly
 * twice the input edge so this crop lands at 512 native with no upsampling.
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
 * runtime hosting the execution provider is itself wasm and runs any node the
 * provider cannot take. Past a phone's few performance cores, threads land on
 * efficiency cores and can make the fast ones wait, so four is the safe default;
 * raise it only on on-device measurement. Needs cross-origin isolation to take
 * effect at all.
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
