import type { DataType } from "@huggingface/transformers";
import type { DetectionBackend } from "./types";

/**
 * D-FINE nano, COCO-trained, converted for Transformers.js. If on-device
 * testing shows unacceptable quality or speed, swap for
 * "onnx-community/rtdetr_v2_r18vd-ONNX".
 */
export const MODEL_ID = "onnx-community/dfine_n_coco-ONNX";

/** Weight precision per backend: fp16 on GPU, 8-bit quantized on WASM. */
export const DTYPE_BY_BACKEND: Readonly<Record<DetectionBackend, DataType>> = {
  webgpu: "fp16",
  wasm: "q8",
};
