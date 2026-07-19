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
 * Two builds are published: an fp16-weight model (~64 MB) for the WebGPU
 * backend and a smaller int8-quantized model (~35 MB) for the WASM fallback.
 * Both have fp32 inputs/outputs, so the same pre/post-processing works for each.
 */
export const MODEL_URL_BY_BACKEND: Readonly<Record<DetectionBackend, string>> =
  {
    webgpu:
      "https://huggingface.co/tuxracer/las-vegas-metro-rfdetr-small-t1/resolve/main/onnx/model_fp16.onnx",
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
