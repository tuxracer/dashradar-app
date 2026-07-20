import type { DetectionBackend } from "./types";

/**
 * RF-DETR small, fine-tuned to detect Las Vegas Metro police vehicles.
 *
 * We run this ONNX model through raw onnxruntime-web rather than the
 * Transformers.js `pipeline("object-detection")` path. The pipeline's built-in
 * DETR post-processor assumes a softmax multi-class head with a background
 * class and picks the arg-max label per query. This model's head is a single
 * real class scored with a per-query sigmoid (index 1 = police, index 0 is an
 * unused slot), so the pipeline decoder reads the logits wrong and drops every
 * detection. Bypassing it lets us apply the correct sigmoid + cxcywh decode.
 *
 * WebGPU streams the full-precision fp32 model (~118 MB) and WASM streams a
 * smaller int8-quantized model (~35 MB). WebGPU deliberately does NOT use the
 * fp16 build: onnxruntime-web's WebGPU GridSample kernel emits invalid WGSL for
 * fp16 tensors (an `f32 * f16` multiply, which WGSL forbids), so its shader
 * fails to compile and GridSample silently produces garbage. RF-DETR's decoder
 * samples features through GridSample, so the fp16 build yields broken
 * detections on every WebGPU device. fp32 makes the multiply `f32 * f32`, which
 * compiles, and as a bonus needs no `shader-f16` GPU feature so it runs on more
 * GPUs. All three builds have fp32 inputs/outputs, so one pre/post-process fits
 * each.
 */
export const MODEL_URL_BY_BACKEND: Readonly<Record<DetectionBackend, string>> =
  {
    webgpu:
      "https://huggingface.co/tuxracer/las-vegas-metro-rfdetr-small-t1/resolve/main/onnx/model.onnx",
    wasm: "https://huggingface.co/tuxracer/las-vegas-metro-rfdetr-small-t1/resolve/main/onnx/model_int8.onnx",
  };

/** Square input edge the model expects (NCHW `[1,3,512,512]`). */
export const INPUT_SIZE = 512;

/** ImageNet channel means (R, G, B) used to normalize the input. */
export const IMAGENET_MEAN: readonly [number, number, number] = [
  0.485, 0.456, 0.406,
];

/** ImageNet channel standard deviations (R, G, B) used to normalize the input. */
export const IMAGENET_STD: readonly [number, number, number] = [
  0.229, 0.224, 0.225,
];

/** Label emitted for every detection this single-class model produces. */
export const POLICE_LABEL = "police";

/**
 * Ceiling on WASM inference threads. Mobile SoCs are big.LITTLE: past the few
 * performance cores, adding threads onto efficiency cores yields little and can
 * make the fast cores wait. Four is a safe default across phones; raise it if
 * on-device measurement shows headroom. Only takes effect when the page is
 * cross-origin isolated (SharedArrayBuffer available); otherwise onnxruntime-web
 * clamps to one thread on its own.
 */
export const WASM_THREAD_CAP = 4;
