import type { NormalizedBox, RawDetection } from "@/types";
import {
  CROP_MAX_EDGE,
  CROP_PADDING,
  IMAGENET_MEAN,
  IMAGENET_STD,
  INPUT_SIZE,
  POLICE_LABEL,
} from "./consts";

/**
 * Convert a 512x512 RGBA frame into the model's `[1,3,512,512]` NCHW float32
 * input: per-channel ImageNet normalization laid out as all R values, then all
 * G, then all B.
 *
 * Pass `out` to write into a preallocated buffer instead of allocating a fresh
 * `Float32Array` each call: the worker reuses one buffer across frames to avoid
 * ~3 MB of per-frame garbage on the detection hot path. Callers that omit it
 * (e.g. tests) get a freshly allocated tensor. `out` must have length
 * `3 * INPUT_SIZE * INPUT_SIZE`.
 */
export const preprocess = (
  imageData: ImageData,
  out?: Float32Array,
): Float32Array => {
  const { data } = imageData;
  const pixels = INPUT_SIZE * INPUT_SIZE;
  const tensor = out ?? new Float32Array(3 * pixels);
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

/**
 * Pixel-space crop rect plus resize target for the contact cutout, ready to
 * hand to `createImageBitmap(frame, sx, sy, sw, sh, { resizeWidth, resizeHeight })`.
 */
export type CropRect = {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  resizeWidth: number;
  resizeHeight: number;
};

/**
 * Crop rect for a detection's cutout: the normalized box padded by
 * CROP_PADDING per side, clamped to the frame, mapped to pixels, and
 * downscaled (never upscaled) so the long edge is at most CROP_MAX_EDGE.
 * Returns undefined when the resulting rect is under a pixel on either axis.
 */
export const cropRect = (
  box: NormalizedBox,
  frameWidth: number,
  frameHeight: number,
): CropRect | undefined => {
  const padX = (box.xmax - box.xmin) * CROP_PADDING;
  const padY = (box.ymax - box.ymin) * CROP_PADDING;
  const sx = Math.floor(Math.max(0, box.xmin - padX) * frameWidth);
  const sy = Math.floor(Math.max(0, box.ymin - padY) * frameHeight);
  const sw = Math.ceil(Math.min(1, box.xmax + padX) * frameWidth) - sx;
  const sh = Math.ceil(Math.min(1, box.ymax + padY) * frameHeight) - sy;
  if (sw < 1 || sh < 1) {
    return undefined;
  }
  const scale = Math.min(1, CROP_MAX_EDGE / Math.max(sw, sh));
  return {
    sx,
    sy,
    sw,
    sh,
    resizeWidth: Math.max(1, Math.round(sw * scale)),
    resizeHeight: Math.max(1, Math.round(sh * scale)),
  };
};

/** Index of the highest-scoring detection, or undefined when there are none. */
export const topDetectionIndex = (
  detections: RawDetection[],
): number | undefined => {
  let top: number | undefined;
  detections.forEach((candidate, index) => {
    if (top === undefined || candidate.score > detections[top].score) {
      top = index;
    }
  });
  return top;
};
