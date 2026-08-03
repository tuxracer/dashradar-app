import type { NormalizedBox, RawDetection } from "@/types";
import { classesFromMetadata } from "@/lib/detectionModels";
import type {
  DetectionClass,
  DetectionModel,
  LoadedModel,
} from "@/lib/detectionModels";
import type { OnnxMetadata } from "@/lib/onnxMetadata";
import {
  BRIGHT_FRACTION_STRIDE,
  BRIGHT_LUMA_THRESHOLD,
  CROP_MAX_EDGE,
  CROP_PADDING,
  FINGERPRINT_STRIDE,
  IMAGENET_MEAN,
  IMAGENET_STD,
  INPUT_SIZE,
} from "./consts";
import { DetectionError } from "./types";

/**
 * The centered square source region of a frame: the region the worker draws
 * onto the model input under center-crop preprocessing, matching the
 * Fill-with-center-crop resize the model trains with. At the default zoom of 1
 * this is the largest centered square, and a square frame yields the whole
 * frame (sx/sy 0).
 *
 * `zoom` shrinks that square by its factor while keeping it centered, which is
 * how the 2x zoom works: the same 512x512 model input then covers
 * half the field of view, so a distant vehicle occupies twice the linear size
 * in the input grid. Values below 1 would crop outside the frame, so they are
 * clamped away rather than honored.
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
 * Map a box normalized to the centered square crop of a frame back into
 * coordinates normalized to the full frame. Under center-crop preprocessing
 * the model's boxes describe the crop, but every downstream consumer (the
 * contact-card cutout, direction shaping, HUD area math) works in full-frame
 * coordinates, so the worker remaps each detection through this before
 * posting it. `zoom` must match the value the crop was taken with, or the
 * boxes land in the wrong place.
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

/**
 * Cheap content fingerprint of a decoded frame, for camera-stall detection.
 * A 32-bit FNV-1a hash over a strided subsample of the RGBA buffer (see
 * FINGERPRINT_STRIDE). Two live camera frames practically never collide because
 * sensor noise perturbs every frame, while a frozen or black feed produces a
 * byte-identical buffer and thus an identical fingerprint. The pixels are
 * already in hand from preprocessing, so this adds negligible cost.
 */
export const frameFingerprint = (imageData: ImageData): number => {
  const { data } = imageData;
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i += FINGERPRINT_STRIDE) {
    hash ^= data[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/**
 * Fraction (0..1) of a strided subsample of the frame whose luma exceeds
 * BRIGHT_LUMA_THRESHOLD, for obscured-lens detection. A physically covered lens
 * presents a noisy near-black frame that the byte-identical fingerprint check
 * cannot catch (sensor noise perturbs every frame), but it has no bright pixels
 * anywhere, so this fraction is essentially zero. A night driving scene keeps
 * some bright region (the road lit by the car's own headlights, oncoming
 * lights, a streetlight), so its fraction stays well above zero. Luma is
 * computed from all three channels so a scene lit by a pure blue or green
 * source is not misread as dark. The pixels are already in hand from
 * preprocessing, so the strided pass adds negligible cost.
 */
export const frameBrightFraction = (imageData: ImageData): number => {
  const { data } = imageData;
  const pixels = data.length / 4;
  let sampled = 0;
  let bright = 0;
  for (let p = 0; p < pixels; p += BRIGHT_FRACTION_STRIDE) {
    const i = p * 4;
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sampled += 1;
    if (luma > BRIGHT_LUMA_THRESHOLD) {
      bright += 1;
    }
  }
  return sampled === 0 ? 0 : bright / sampled;
};

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * Pair a registry entry with what the session built from it turned out to hold:
 * the head width from the `dims` of the `labels` tensor its first run produced,
 * and the classes from the `names` map stamped into the weights.
 *
 * Both are measured rather than declared, and the pairing is what makes that
 * safe. A hand-written class table can be paired with the wrong checkpoint and
 * report POLICE at every pedestrian off a 91-wide COCO head; labels read from
 * the same file as the logits they index cannot disagree with them, so the
 * failure mode a declared head width used to catch no longer exists to catch.
 * Indices the head cannot hold are dropped during derivation, which is where a
 * `names` map that disagrees with its own graph loses.
 *
 * What is left to fail on is a `labels` output that is not shaped like a
 * classification head at all, which throws MODEL_LOAD_FAILED at load, before
 * the camera is asked for, rather than on the first decoded frame.
 */
export const resolveLoadedModel = (
  labelsDims: readonly number[],
  model: DetectionModel,
  metadata?: OnnxMetadata,
): LoadedModel => {
  // [batch, queries, classes]. Anything else is not a head this decode can read
  // its per-query stride out of.
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
 * Decode the model's raw outputs into normalized detections.
 *
 * `dets` is `[1,N,4]` cxcywh boxes (normalized 0..1). `labels` is
 * `[1,N,headWidth]` raw class logits, where slot 0 is an unused background
 * slot. Each query takes the highest-scoring class the model's table names,
 * and is emitted when that class's `sigmoid(logit)` clears `threshold`. One box
 * gets one class: the head is multi-label in principle, but a HUD box carrying
 * two names is no use to a driver glancing at it. RF-DETR is set-based, so no
 * NMS is applied.
 *
 * The model arrives already reconciled with the session it was loaded from (see
 * resolveLoadedModel), so the table and its width are not re-checked per frame.
 * What is still checked here is that the two tensors agree with each other: a
 * `labels` length that is not the query count times the stride means the head
 * would be read at the wrong offset from the second query on, so this throws
 * MODEL_LOAD_FAILED rather than emitting plausible garbage. The query count
 * comes from the tensor lengths rather than their dims, which keeps this
 * function pure and works the same on the graph-capture path, where outputs
 * arrive through getData().
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
 * Return a buffer with capacity for `needed` bytes, preserving the first
 * `loaded` bytes already written. Used by the worker's model download: the
 * final buffer is preallocated from Content-Length so streamed chunks land in
 * place with no end-of-download copy, and this growth path only runs when
 * Content-Length was absent or understated the body. Growth at least doubles
 * the capacity so repeated growth stays amortized-linear.
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
