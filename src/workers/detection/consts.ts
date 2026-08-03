/**
 * How this file's constants relate to the checkpoint that ships, an RF-DETR
 * small fine-tuned to detect Las Vegas Metro police vehicles.
 *
 * We run this ONNX model through raw onnxruntime-web rather than the
 * Transformers.js `pipeline("object-detection")` path. The pipeline's built-in
 * DETR post-processor assumes a softmax multi-class head with a background
 * class and picks the arg-max label per query. This model's head is a sigmoid
 * head scored per class per query, real classes starting at index 1 (index 0
 * is an unused background slot), so the pipeline decoder reads the logits
 * wrong and drops every detection. Bypassing it lets us apply the correct
 * sigmoid + cxcywh decode.
 *
 * The model itself is described in src/lib/detectionModels, one entry per
 * selectable checkpoint: its repo, revision, weights file, and classes. The
 * constants here cover the parts of running one that every checkpoint shares.
 *
 * That entry names one build: the mixed-precision fp16 model (~57 MB: fp16
 * weights and compute, the three GridSample nodes kept fp32 behind boundary
 * Casts), run on WebGPU. It requires the `shader-f16` GPU feature, which
 * `probeWebGpu` gates on, and became usable when the worker moved to the
 * native C++ WebGPU EP ("onnxruntime-web/webgpu"): under the old JSEP path, a
 * pure-fp16 GridSample produced garbage from a broken WGSL shader, which is
 * why the mixed-precision export keeps those nodes fp32 (see the GridSample
 * gotcha in CLAUDE.md). Inputs and outputs are fp32, so preprocess/decode are
 * unchanged.
 *
 * There is deliberately no CPU (wasm) build or fallback. The int8 model that
 * used to serve it measured round trips over 10 s on an Android phone where
 * WebGPU takes ~500 ms; scanning the road once every ten seconds misses most
 * of what the car drives past, so a device without usable WebGPU is turned
 * away with WEBGPU_UNSUPPORTED rather than handed a detector that looks like
 * it works and does not.
 */

/**
 * CacheStorage cache the worker writes downloaded weights into on the dev
 * server, where no service worker (and so no Workbox "model-cache" route)
 * exists to cache them. It holds one entry per registered model, each keyed on
 * that model's own revision-pinned URL, so a model whose revision has not moved
 * loads locally across dev launches while a bumped one misses and
 * re-downloads, and switching between two models does not evict either.
 * Unused in production builds, where the service worker owns model caching.
 */
export const DEV_MODEL_CACHE_NAME = "model-cache-dev";

/**
 * Attempt a WebGPU session with graph capture (`enableGraphCapture`) before
 * falling back to a plain session. Requires the native C++ WebGPU EP (the
 * worker's "onnxruntime-web/webgpu" import with the asyncify runtime): the
 * root import's JSEP implementation has no TopK kernel, parks this graph's
 * TopK on the CPU EP, and fails capture's all-nodes-partitioned check on
 * every device. On devices where capture still cannot initialize or run, the
 * worker falls back to a plain WebGPU session and the debug overlay's
 * "graph capture" row reads "failed" with the reason.
 *
 * WebKit never attempts capture regardless of this flag (`isWebKitUa` in
 * `src/lib/browserEngine`, checked in `createModel`); it runs a plain WebGPU
 * session and the overlay row reads "disabled". The exclusion rests on
 * measured cost/benefit, not crash attribution: on an iPhone 16e in Safari,
 * round trips with capture on are about the same as without, so the
 * dispatch-replay win that makes capture worthwhile on Chromium Android never
 * materializes on WebKit's WebGPU implementation. A feature with no measured
 * upside only has to be suspected of instability to lose its place, and iOS
 * crash volume with capture enabled supplies the suspicion.
 *
 * History, because this exclusion existed once before on different grounds
 * and that reasoning was wrong: the first exclusion rested on a single crash
 * event tagged `graphCapture: true`, and reading all of Sentry DASHRADAR-2
 * later showed nine of the ten iOS crashes had capture *off*, all inside the
 * first ~21 s of scanning, a startup signature capture does not touch. That
 * finding still stands; crash telemetry never implicated capture and is not
 * what justifies this exclusion. What would lift it is a demonstrated WebKit
 * round-trip improvement worth the risk, verified on a real iPhone.
 */
export const WEBGPU_GRAPH_CAPTURE = true;

/** Square input edge the model expects (NCHW `[1,3,512,512]`). */
export const INPUT_SIZE = 512;

/**
 * Shortest box edge, in model-input pixels, a decoded detection needs to be
 * kept. Below this a vehicle covers too few pixels of the 512x512 input to
 * carry class-distinguishing detail (a police Tahoe and a civilian Tahoe read
 * the same at that size), so tiny boxes are dropped as false-positive fuel
 * rather than alerted on. Applied in decode, where boxes are still in crop
 * space: the gate measures the pixels the model actually saw, so the 2x zoom
 * genuinely rescues distant vehicles instead of being cancelled out by the
 * full-frame remap.
 */
export const MIN_BOX_EDGE_PX = 15;

/**
 * Crop factor the 2x zoom applies: the centered square fed to the
 * model shrinks to half its side, so the same 512x512 input covers half the
 * field of view and a distant vehicle occupies twice the linear size in the
 * input grid. A fixed step rather than a continuous range because native
 * camera zoom is unavailable on iOS Safari and reports device-defined units on
 * Chrome Android, so cropping the frame ourselves is the only way one setting
 * means the same thing on both.
 *
 * CAMERA_CONSTRAINTS requests roughly twice the model's input edge so this
 * crop lands at 512 native with no upsampling.
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
 * Ceiling on onnxruntime-web's wasm runtime threads. Inference runs on the GPU,
 * but the runtime hosting the WebGPU execution provider is itself a wasm module
 * and runs any node the provider cannot take, so the thread count still
 * matters. Mobile SoCs are big.LITTLE: past the few performance cores, adding
 * threads onto efficiency cores yields little and can make the fast cores wait.
 * Four is a safe default across phones; raise it if on-device measurement shows
 * headroom. Only takes effect when the page is cross-origin isolated
 * (SharedArrayBuffer available); otherwise onnxruntime-web clamps to one thread
 * on its own.
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

/**
 * JPEG quality for the model-input capture returned with a detection when the
 * context asks for it (debug-mode frame saving). High enough that compression
 * artifacts stay irrelevant for training data, at a fraction of PNG size.
 */
export const FRAME_JPEG_QUALITY = 0.92;

/**
 * Byte stride for frameFingerprint's subsample of the decoded RGBA frame. The
 * 512x512 input is 1,048,576 bytes; stepping 16 samples one channel byte per 4
 * pixels (~65k samples), enough to distinguish any two live camera frames while
 * staying a cheap fixed-cost loop on the detection hot path.
 */
export const FINGERPRINT_STRIDE = 16;

/**
 * Luma (Rec. 601) above which a subsampled pixel counts as "bright" for
 * frameBrightFraction. Set well above the reference obscured frame's brightest
 * pixel (luma ~21) and far below any real light source a night scene contains
 * (headlights, streetlights, dashboard glow are 150-255), so a covered lens
 * reads as zero bright pixels while any genuine illumination does not.
 */
export const BRIGHT_LUMA_THRESHOLD = 48;

/**
 * Pixel stride for frameBrightFraction's subsample of the decoded RGBA frame.
 * Stepping 4 pixels samples ~65k of the 512x512 frame's pixels, enough to
 * measure whether any bright region exists while staying a cheap fixed-cost
 * loop on the detection hot path. A separate stride from FINGERPRINT_STRIDE
 * because that one steps raw bytes and samples the red channel only, while this
 * pass reads all three channels per sampled pixel to compute luma.
 */
export const BRIGHT_FRACTION_STRIDE = 4;
