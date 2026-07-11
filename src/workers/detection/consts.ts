import type { DataType } from "@huggingface/transformers";
import type { DetectionBackend } from "./types";

/**
 * RT-DETRv2 (r18vd backbone), COCO-trained, converted for Transformers.js.
 *
 * D-FINE nano ("onnx-community/dfine_n_coco-ONNX") was tried first but its
 * graph fails onnxruntime-web's WebGPU execution provider on every frame
 * (OrtRun: "Invalid dimension of 4294967295 for SizeToDimension") regardless
 * of dtype (reproduced with both fp16 and fp32); it only works on wasm. This
 * model runs cleanly on both the webgpu and wasm backends, so it replaces
 * D-FINE rather than adding a workaround for a broken graph.
 */
export const MODEL_ID = "onnx-community/rtdetr_v2_r18vd-ONNX";

/** Weight precision per backend: fp16 on GPU, 8-bit quantized on WASM. */
export const DTYPE_BY_BACKEND: Readonly<Record<DetectionBackend, DataType>> = {
  webgpu: "fp16",
  wasm: "q8",
};
