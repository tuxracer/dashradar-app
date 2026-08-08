import type { NormalizedBox, RawDetection } from "@/types";
import { classesFromMetadata } from "@/lib/detectionModels";
import type {
  DetectionClass,
  DetectionModel,
  LoadedModel,
} from "@/lib/detectionModels";
import type { OnnxMetadata } from "@/lib/onnxMetadata";
import {
  CROP_MAX_EDGE,
  CROP_PADDING,
  IMAGENET_MEAN,
  IMAGENET_STD,
  INPUT_SIZE,
} from "./consts";
import { DetectionError } from "./types";

/**
 * The centered square drawn onto the model input, matching the
 * fill-with-center-crop resize the model trains with. `zoom` shrinks that square
 * while keeping it centered, so the same input covers a narrower field of view;
 * values below 1 would crop outside the frame and are clamped away.
 */
export const centerCropRegion = (
  width: number,
  height: number,
  zoom = 1,
): { sx: number; sy: number; side: number } => {
  const side = Math.min(width, height) / Math.max(1, zoom);
  return { sx: (width - side) / 2, sy: (height - side) / 2, side };
};

/**
 * Map a box normalized to the crop back into full-frame coordinates, which is
 * what every consumer downstream works in. `zoom` must match the value the crop
 * was taken with or the boxes land in the wrong place.
 */
export const mapCropBoxToFrame = (
  box: NormalizedBox,
  frameWidth: number,
  frameHeight: number,
  zoom = 1,
): NormalizedBox => {
  const { sx, sy, side } = centerCropRegion(frameWidth, frameHeight, zoom);
  return {
    xmin: (sx + box.xmin * side) / frameWidth,
    ymin: (sy + box.ymin * side) / frameHeight,
    xmax: (sx + box.xmax * side) / frameWidth,
    ymax: (sy + box.ymax * side) / frameHeight,
  };
};

/**
 * Convert an RGBA frame into the model's NCHW float32 input: ImageNet
 * normalization laid out as all R, then all G, then all B. `out` writes into a
 * preallocated buffer, keeping ~3 MB of garbage per frame off the hot path.
 */
export const preprocess = (
  imageData: ImageData,
  out?: Float32Array<ArrayBuffer>,
): Float32Array<ArrayBuffer> => {
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
 * Pair a registry entry with what its session turned out to hold: the head width
 * off the `labels` dims, the classes off the `names` map in the weights. Both
 * measured rather than declared, so they cannot disagree the way a hand-written
 * table paired with the wrong checkpoint would. A `labels` output not shaped like
 * a classification head throws at load, not on the first decoded frame.
 */
export const resolveLoadedModel = (
  labelsDims: readonly number[],
  model: DetectionModel,
  metadata?: OnnxMetadata,
): LoadedModel => {
  // [batch, queries, classes]; anything else has no per-query stride to read.
  if (labelsDims.length !== 3) {
    throw new DetectionError("MODEL_LOAD_FAILED");
  }
  const headWidth = labelsDims[2];
  if (!Number.isInteger(headWidth) || headWidth < 2) {
    throw new DetectionError("MODEL_LOAD_FAILED");
  }
  return {
    ...model,
    headWidth,
    classes: classesFromMetadata(metadata, headWidth),
  };
};

/**
 * Decode the raw outputs into normalized detections. Each query takes its
 * highest-scoring named class and is emitted when that class's sigmoid clears
 * `threshold`. One box gets one class, since a HUD box with two names is no use
 * to a driver, and RF-DETR is set-based so there is no NMS.
 *
 * The two tensors are checked against each other: a `labels` length that is not
 * the query count times the stride would read the head at the wrong offset. The
 * count comes from tensor lengths rather than dims, which keeps this pure.
 */
export const decodeDetections = (
  dets: Float32Array,
  labels: Float32Array,
  threshold: number,
  model: LoadedModel,
): RawDetection[] => {
  const queryCount = Math.floor(dets.length / 4);
  if (queryCount === 0) {
    return [];
  }
  const { headWidth, classes } = model;
  if (labels.length / queryCount !== headWidth) {
    throw new DetectionError("MODEL_LOAD_FAILED");
  }
  const detections: RawDetection[] = [];
  for (let q = 0; q < queryCount; q += 1) {
    let bestScore = -1;
    let best: DetectionClass | undefined;
    for (const entry of classes) {
      const score = sigmoid(labels[q * headWidth + entry.index]);
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }
    if (!best || bestScore < threshold) {
      continue;
    }
    const cx = dets[q * 4];
    const cy = dets[q * 4 + 1];
    const w = dets[q * 4 + 2];
    const h = dets[q * 4 + 3];
    // `dets` and `labels` are independent outputs, so an fp16 pathology can hand
    // an above-threshold score a NaN box. clamp01 passes NaN through, and the
    // detection then reads as the frame's strongest while carrying geometry no
    // consumer can draw, crop, or match.
    if (
      !Number.isFinite(cx) ||
      !Number.isFinite(cy) ||
      !Number.isFinite(w) ||
      !Number.isFinite(h)
    ) {
      continue;
    }
    detections.push({
      label: best.label,
      score: bestScore,
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

/**
 * A buffer with capacity for `needed` bytes, preserving the first `loaded`. The
 * download preallocates from Content-Length, so this only runs when that was
 * absent or understated the body. Growth at least doubles, staying amortized.
 */
export const ensureCapacity = (
  buffer: Uint8Array<ArrayBuffer>,
  loaded: number,
  needed: number,
): Uint8Array<ArrayBuffer> => {
  if (needed <= buffer.byteLength) {
    return buffer;
  }
  const grown = new Uint8Array(Math.max(needed, buffer.byteLength * 2));
  grown.set(buffer.subarray(0, loaded));
  return grown;
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
