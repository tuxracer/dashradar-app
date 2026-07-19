import type { RawDetection } from "@/types";
import {
  IMAGENET_MEAN,
  IMAGENET_STD,
  INPUT_SIZE,
  POLICE_LABEL,
} from "./consts";

/**
 * Convert a 512x512 RGBA frame into the model's `[1,3,512,512]` NCHW float32
 * input: per-channel ImageNet normalization laid out as all R values, then all
 * G, then all B.
 */
export const preprocess = (imageData: ImageData): Float32Array => {
  const { data } = imageData;
  const pixels = INPUT_SIZE * INPUT_SIZE;
  const tensor = new Float32Array(3 * pixels);
  for (let i = 0; i < pixels; i += 1) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    tensor[i] = (r - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
    tensor[pixels + i] = (g - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
    tensor[2 * pixels + i] = (b - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
  }
  return tensor;
};

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * Decode the model's raw outputs into normalized detections.
 *
 * `dets` is `[1,N,4]` cxcywh boxes (normalized 0..1). `labels` is `[1,N,2]` raw
 * class logits; class index 1 is the police vehicle (index 0 is an unused
 * background slot). A query is emitted when `sigmoid(policeLogit) >= threshold`.
 * RF-DETR is set-based, so no NMS is applied.
 */
export const decodeDetections = (
  dets: Float32Array,
  labels: Float32Array,
  threshold: number,
): RawDetection[] => {
  const queryCount = Math.floor(labels.length / 2);
  const detections: RawDetection[] = [];
  for (let q = 0; q < queryCount; q += 1) {
    const score = sigmoid(labels[q * 2 + 1]);
    if (score < threshold) {
      continue;
    }
    const cx = dets[q * 4];
    const cy = dets[q * 4 + 1];
    const w = dets[q * 4 + 2];
    const h = dets[q * 4 + 3];
    detections.push({
      label: POLICE_LABEL,
      score,
      box: {
        xmin: clamp01(cx - w / 2),
        ymin: clamp01(cy - h / 2),
        xmax: clamp01(cx + w / 2),
        ymax: clamp01(cy + h / 2),
      },
    });
  }
  return detections;
};
