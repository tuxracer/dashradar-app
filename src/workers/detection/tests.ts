import { afterEach, describe, expect, it, vi } from "vitest";
import {
  centerCropRegion,
  cropRect,
  decodeDetections,
  ensureCapacity,
  frameBrightFraction,
  frameFingerprint,
  mapCropBoxToFrame,
  preprocess,
  topDetectionIndex,
} from "@/workers/detection/inference";
import {
  CROP_MAX_EDGE,
  IMAGENET_MEAN,
  IMAGENET_STD,
  INPUT_SIZE,
  MIN_BOX_EDGE_PX,
  ZOOM_2X,
} from "@/workers/detection/consts";
import {
  isDetectionError,
  isWorkerRequest,
  isWorkerResponse,
} from "@/workers/detection/types";
import { DEFAULT_MODEL } from "@/lib/detectionModels";
import type { RawDetection } from "@/types";

/** Build a `[1,queries,C]` logits buffer from per-query score rows. */
const makeLabels = (rows: readonly number[][]): Float32Array =>
  Float32Array.from(rows.flat());

/** Build a `[1,queries,4]` cxcywh box buffer. */
const makeBoxes = (
  boxes: readonly [number, number, number, number][],
): Float32Array => Float32Array.from(boxes.flat());

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/** Minimal stand-in for ImageBitmap, which jsdom does not provide. */
class FakeImageBitmap {
  width = 320;
  height = 240;
  close = vi.fn();
}

describe("isWorkerRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts a load with no model id, which means the shipping model", () => {
    expect(isWorkerRequest({ type: "load" })).toBe(true);
  });

  it("accepts a load naming a model", () => {
    expect(isWorkerRequest({ type: "load", modelId: "las-vegas-metro" })).toBe(
      true,
    );
  });

  it("rejects a load whose model id is not a string", () => {
    expect(isWorkerRequest({ type: "load", modelId: 3 })).toBe(false);
  });

  it("accepts detect with and without the includeFrame flag", () => {
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    const frame = new FakeImageBitmap();
    expect(isWorkerRequest({ type: "detect", frame })).toBe(true);
    expect(isWorkerRequest({ type: "detect", frame, includeFrame: true })).toBe(
      true,
    );
    expect(
      isWorkerRequest({ type: "detect", frame, includeFrame: false }),
    ).toBe(true);
  });

  it("rejects a non-boolean includeFrame", () => {
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    const frame = new FakeImageBitmap();
    expect(
      isWorkerRequest({ type: "detect", frame, includeFrame: "yes" }),
    ).toBe(false);
  });

  it("accepts detect with and without the includeThumbnail flag", () => {
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    const frame = new FakeImageBitmap();
    expect(
      isWorkerRequest({ type: "detect", frame, includeThumbnail: true }),
    ).toBe(true);
    expect(
      isWorkerRequest({ type: "detect", frame, includeThumbnail: false }),
    ).toBe(true);
  });

  it("rejects a non-boolean includeThumbnail", () => {
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    const frame = new FakeImageBitmap();
    expect(
      isWorkerRequest({ type: "detect", frame, includeThumbnail: 1 }),
    ).toBe(false);
  });

  it("accepts detect with and without the includeCrop flag", () => {
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    const frame = new FakeImageBitmap();
    expect(isWorkerRequest({ type: "detect", frame, includeCrop: true })).toBe(
      true,
    );
    expect(isWorkerRequest({ type: "detect", frame, includeCrop: false })).toBe(
      true,
    );
  });

  it("rejects a non-boolean includeCrop", () => {
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    const frame = new FakeImageBitmap();
    expect(isWorkerRequest({ type: "detect", frame, includeCrop: "no" })).toBe(
      false,
    );
  });

  it("accepts a detect message carrying a numeric confidenceThreshold", () => {
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    const frame = new FakeImageBitmap();
    expect(
      isWorkerRequest({ type: "detect", frame, confidenceThreshold: 0.3 }),
    ).toBe(true);
  });

  it("rejects a non-number confidenceThreshold", () => {
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    const frame = new FakeImageBitmap();
    expect(
      isWorkerRequest({ type: "detect", frame, confidenceThreshold: "0.3" }),
    ).toBe(false);
  });
});

describe("isWorkerResponse", () => {
  it("accepts every response variant", () => {
    expect(
      isWorkerResponse({
        type: "model-progress",
        progress: { file: "model.onnx", loaded: 10, total: 100 },
      }),
    ).toBe(true);
    expect(isWorkerResponse({ type: "ready" })).toBe(true);
    expect(
      isWorkerResponse({ type: "worker-error", code: "WEBGPU_UNSUPPORTED" }),
    ).toBe(true);
    expect(
      isWorkerResponse({
        type: "detections",
        detections: [],
        timing: { preprocessMs: 1, inferenceMs: 2, decodeMs: 3 },
      }),
    ).toBe(true);
    expect(
      isWorkerResponse({ type: "worker-error", code: "MODEL_LOAD_FAILED" }),
    ).toBe(true);
    expect(
      isWorkerResponse({
        type: "worker-error",
        code: "GPU_DEVICE_LOST",
        detail: "unknown: the GPU process exited",
      }),
    ).toBe(true);
  });

  it("rejects malformed messages", () => {
    expect(isWorkerResponse(null)).toBe(false);
    expect(isWorkerResponse({ type: "detections" })).toBe(false);
    expect(isWorkerResponse({ type: "detections", detections: [] })).toBe(
      false,
    );
    expect(isWorkerResponse({ type: "worker-error", code: "NOPE" })).toBe(
      false,
    );
    expect(
      isWorkerResponse({
        type: "worker-error",
        code: "GPU_DEVICE_LOST",
        detail: 42,
      }),
    ).toBe(false);
    expect(isWorkerResponse({ type: "model-progress", progress: {} })).toBe(
      false,
    );
  });

  it("accepts a detections message carrying a saved-frame blob", () => {
    expect(
      isWorkerResponse({
        type: "detections",
        detections: [],
        timing: { preprocessMs: 1, inferenceMs: 2, decodeMs: 3 },
        frame: new Blob(["jpeg"], { type: "image/jpeg" }),
      }),
    ).toBe(true);
  });

  it("rejects a detections message whose frame is not a Blob", () => {
    expect(
      isWorkerResponse({
        type: "detections",
        detections: [],
        timing: { preprocessMs: 1, inferenceMs: 2, decodeMs: 3 },
        frame: "not-a-blob",
      }),
    ).toBe(false);
  });

  it("accepts a detections message carrying a fingerprint", () => {
    expect(
      isWorkerResponse({
        type: "detections",
        detections: [],
        timing: { preprocessMs: 1, inferenceMs: 2, decodeMs: 3 },
        fingerprint: 12_345,
      }),
    ).toBe(true);
  });

  it("rejects a detections message with a non-number fingerprint", () => {
    expect(
      isWorkerResponse({
        type: "detections",
        detections: [],
        timing: { preprocessMs: 1, inferenceMs: 2, decodeMs: 3 },
        fingerprint: "nope",
      }),
    ).toBe(false);
  });

  it("accepts a detections message carrying a brightFraction", () => {
    expect(
      isWorkerResponse({
        type: "detections",
        detections: [],
        timing: { preprocessMs: 1, inferenceMs: 2, decodeMs: 3 },
        brightFraction: 0.42,
      }),
    ).toBe(true);
  });

  it("rejects a detections message with a non-number brightFraction", () => {
    expect(
      isWorkerResponse({
        type: "detections",
        detections: [],
        timing: { preprocessMs: 1, inferenceMs: 2, decodeMs: 3 },
        brightFraction: "nope",
      }),
    ).toBe(false);
  });
});

describe("preprocess", () => {
  const pixels = INPUT_SIZE * INPUT_SIZE;

  /** ImageNet-normalized value for a raw 0..255 channel byte. */
  const normalized = (byte: number, channel: number): number =>
    (byte / 255 - IMAGENET_MEAN[channel]) / IMAGENET_STD[channel];

  // A full-size RGBA buffer with the first pixel opaque orange (r=255, g=128,
  // b=0) and the rest zero. Built as a structural ImageData so the test runs
  // without a DOM; preprocess only reads `.data`.
  const makeImageData = (): ImageData => {
    const data = new Uint8ClampedArray(pixels * 4);
    data.set([255, 128, 0, 255], 0);
    return { data, width: INPUT_SIZE, height: INPUT_SIZE, colorSpace: "srgb" };
  };

  it("normalizes RGB into planar NCHW layout", () => {
    const tensor = preprocess(makeImageData());

    expect(tensor).toHaveLength(3 * pixels);
    expect(tensor[0]).toBeCloseTo(normalized(255, 0), 6);
    expect(tensor[pixels]).toBeCloseTo(normalized(128, 1), 6);
    expect(tensor[2 * pixels]).toBeCloseTo(normalized(0, 2), 6);
  });

  it("writes into the provided buffer and returns it instead of allocating", () => {
    const out = new Float32Array(3 * pixels);

    const tensor = preprocess(makeImageData(), out);

    expect(tensor).toBe(out);
    expect(out[0]).toBeCloseTo(normalized(255, 0), 6);
  });
});

describe("frameFingerprint", () => {
  const pixels = INPUT_SIZE * INPUT_SIZE;

  /** Structural full-size RGBA ImageData; frameFingerprint only reads `.data`. */
  const imageDataFrom = (
    mutate?: (data: Uint8ClampedArray) => void,
  ): ImageData => {
    const data = new Uint8ClampedArray(pixels * 4);
    data.fill(120);
    mutate?.(data);
    return { data, width: INPUT_SIZE, height: INPUT_SIZE, colorSpace: "srgb" };
  };

  it("hashes byte-identical frames to the same value", () => {
    expect(frameFingerprint(imageDataFrom())).toBe(
      frameFingerprint(imageDataFrom()),
    );
  });

  it("hashes differing frames to different values", () => {
    const base = frameFingerprint(imageDataFrom());
    // Change a sampled byte (index 0 is on the stride) so the hash must differ.
    const changed = frameFingerprint(imageDataFrom((data) => (data[0] = 250)));
    expect(changed).not.toBe(base);
  });

  it("returns an unsigned 32-bit integer", () => {
    const hash = frameFingerprint(imageDataFrom());
    expect(Number.isInteger(hash)).toBe(true);
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThanOrEqual(0xffffffff);
  });
});

describe("frameBrightFraction", () => {
  const pixels = INPUT_SIZE * INPUT_SIZE;

  /**
   * Structural full-size RGBA ImageData filled with one gray level, so every
   * pixel's luma is that level. frameBrightFraction only reads `.data`.
   */
  const solidFrame = (level: number): ImageData => {
    const data = new Uint8ClampedArray(pixels * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = level;
      data[i + 1] = level;
      data[i + 2] = level;
      data[i + 3] = 255;
    }
    return { data, width: INPUT_SIZE, height: INPUT_SIZE, colorSpace: "srgb" };
  };

  it("returns zero for an all-dark frame", () => {
    expect(frameBrightFraction(solidFrame(8))).toBe(0);
  });

  it("returns zero for a near-black frame just under the threshold", () => {
    // Every pixel at luma ~24 (below BRIGHT_LUMA_THRESHOLD 48): the noisy-black
    // obscured case, where no pixel is bright even though it is not pure black.
    expect(frameBrightFraction(solidFrame(24))).toBe(0);
  });

  it("returns ~1 for a fully bright frame", () => {
    expect(frameBrightFraction(solidFrame(200))).toBeGreaterThan(0.99);
  });

  it("returns a small nonzero fraction for a mostly-dark frame with a bright patch", () => {
    // Dark everywhere except the first 2000 pixels set bright: a lit region in
    // an otherwise dark scene, which must read as nonzero (do not recover).
    const frame = solidFrame(8);
    for (let p = 0; p < 2_000; p += 1) {
      frame.data[p * 4] = 255;
      frame.data[p * 4 + 1] = 255;
      frame.data[p * 4 + 2] = 255;
    }
    const fraction = frameBrightFraction(frame);
    expect(fraction).toBeGreaterThan(0);
    expect(fraction).toBeLessThan(0.05);
  });
});

describe("decodeDetections", () => {
  it("emits a police detection with the sigmoid score and clamped xyxy box", () => {
    // One query, high class-1 logit, cxcywh centered box within bounds.
    const labels = makeLabels([[-8, 4]]);
    const boxes = makeBoxes([[0.5, 0.5, 0.4, 0.2]]);

    const detections = decodeDetections(boxes, labels, 0.5);

    expect(detections).toHaveLength(1);
    expect(detections[0].label).toBe("police");
    expect(detections[0].score).toBeCloseTo(sigmoid(4), 6);
    expect(detections[0].box.xmin).toBeCloseTo(0.3, 6);
    expect(detections[0].box.ymin).toBeCloseTo(0.4, 6);
    expect(detections[0].box.xmax).toBeCloseTo(0.7, 6);
    expect(detections[0].box.ymax).toBeCloseTo(0.6, 6);
  });

  it("clamps boxes that spill past the frame edges to [0,1]", () => {
    const labels = makeLabels([[-8, 4]]);
    // Wide/tall box centered at origin corner overflows on the low side.
    const boxes = makeBoxes([[0.1, 0.1, 0.6, 0.6]]);

    const detections = decodeDetections(boxes, labels, 0.5);

    expect(detections[0].box.xmin).toBe(0);
    expect(detections[0].box.ymin).toBe(0);
    expect(detections[0].box.xmax).toBeCloseTo(0.4, 6);
    expect(detections[0].box.ymax).toBeCloseTo(0.4, 6);
  });

  it("drops a query whose police score is below threshold", () => {
    // sigmoid(-1) ~= 0.269, under the 0.5 threshold.
    const labels = makeLabels([[-8, -1]]);
    const boxes = makeBoxes([[0.5, 0.5, 0.4, 0.2]]);

    expect(decodeDetections(boxes, labels, 0.5)).toHaveLength(0);
  });

  it("ignores the class-0 slot entirely", () => {
    // Strong class-0 signal, negative class-1: no detection should surface.
    const labels = makeLabels([[10, -8]]);
    const boxes = makeBoxes([[0.5, 0.5, 0.4, 0.2]]);

    expect(decodeDetections(boxes, labels, 0.5)).toHaveLength(0);
  });

  it("keeps only the queries that clear the threshold", () => {
    const labels = makeLabels([
      [-8, 4],
      [-8, -3],
      [-8, 5],
    ]);
    const boxes = makeBoxes([
      [0.5, 0.5, 0.2, 0.2],
      [0.1, 0.1, 0.1, 0.1],
      [0.8, 0.8, 0.2, 0.2],
    ]);

    const detections = decodeDetections(boxes, labels, 0.5);

    expect(detections).toHaveLength(2);
    expect(detections.map((detection) => detection.score)).toEqual([
      sigmoid(4),
      sigmoid(5),
    ]);
  });

  it("drops a confident detection whose box is too small to classify", () => {
    const labels = makeLabels([[-8, 4]]);
    // A square just under the minimum edge: too few input pixels to tell a
    // police vehicle from a civilian one, whatever the score says.
    const side = (MIN_BOX_EDGE_PX - 1) / INPUT_SIZE;
    const boxes = makeBoxes([[0.5, 0.5, side, side]]);

    expect(decodeDetections(boxes, labels, 0.5)).toHaveLength(0);
  });

  it("drops a wide box whose short edge is under the minimum", () => {
    const labels = makeLabels([[-8, 4]]);
    // Plenty of width, sliver of height: the short edge is what carries the
    // detail, so the box is still unclassifiable.
    const boxes = makeBoxes([
      [0.5, 0.5, 0.5, (MIN_BOX_EDGE_PX - 1) / INPUT_SIZE],
    ]);

    expect(decodeDetections(boxes, labels, 0.5)).toHaveLength(0);
  });

  it("keeps a box exactly at the minimum edge", () => {
    const labels = makeLabels([[-8, 4]]);
    const side = MIN_BOX_EDGE_PX / INPUT_SIZE;
    const boxes = makeBoxes([[0.5, 0.5, side, side]]);

    expect(decodeDetections(boxes, labels, 0.5)).toHaveLength(1);
  });

  /** A two-class table, for driving decode past the single class that ships. */
  const TWO_CLASSES = [
    { label: "police", displayLabel: "POLICE", category: "vehicle" },
    { label: "person", displayLabel: "PERSON", category: "person" },
  ] as const;

  it("labels a query with its highest-scoring class", () => {
    // One query, 3-wide head: background, weak police, strong person.
    const labels = makeLabels([[-8, 1, 4]]);
    const boxes = makeBoxes([[0.5, 0.5, 0.4, 0.2]]);

    const detections = decodeDetections(boxes, labels, 0.5, TWO_CLASSES);

    expect(detections).toHaveLength(1);
    expect(detections[0].label).toBe("person");
    expect(detections[0].score).toBeCloseTo(sigmoid(4), 6);
  });

  it("reads each query at its own offset in a wider head", () => {
    // Two queries: the first is police, the second is person. A decode that
    // kept the 2-wide stride would read the second query's slots off the end
    // of the first.
    const labels = makeLabels([
      [-8, 4, -8],
      [-8, -8, 4],
    ]);
    const boxes = makeBoxes([
      [0.5, 0.5, 0.4, 0.2],
      [0.2, 0.2, 0.2, 0.2],
    ]);

    const detections = decodeDetections(boxes, labels, 0.5, TWO_CLASSES);

    expect(detections.map((d) => d.label)).toEqual(["police", "person"]);
  });

  it("drops a query whose best class is still below threshold", () => {
    // sigmoid(-1) ~= 0.269 and sigmoid(-2) ~= 0.119, both under 0.5.
    const labels = makeLabels([[-8, -1, -2]]);
    const boxes = makeBoxes([[0.5, 0.5, 0.4, 0.2]]);

    expect(decodeDetections(boxes, labels, 0.5, TWO_CLASSES)).toHaveLength(0);
  });

  it("rejects a model whose head does not match the class table", () => {
    // A 3-wide head decoded against a 1-class table: every box would be
    // misread, so this must fail loudly rather than emit garbage.
    const labels = makeLabels([[-8, 4, -8]]);
    const boxes = makeBoxes([[0.5, 0.5, 0.4, 0.2]]);

    let thrown: unknown;
    try {
      decodeDetections(boxes, labels, 0.5, DEFAULT_MODEL.classes);
    } catch (error) {
      thrown = error;
    }
    expect(isDetectionError(thrown)).toBe(true);
    expect(isDetectionError(thrown) && thrown.code).toBe("MODEL_LOAD_FAILED");
  });

  it("returns no detections for an empty output rather than failing the guard", () => {
    expect(
      decodeDetections(new Float32Array(0), new Float32Array(0), 0.5),
    ).toEqual([]);
  });
});

describe("centerCropRegion", () => {
  it("crops the width of a landscape frame, centered", () => {
    expect(centerCropRegion(1024, 512)).toEqual({ sx: 256, sy: 0, side: 512 });
  });

  it("crops the height of a portrait frame, centered", () => {
    expect(centerCropRegion(480, 640)).toEqual({ sx: 0, sy: 80, side: 480 });
  });

  it("covers a square frame exactly", () => {
    expect(centerCropRegion(512, 512)).toEqual({ sx: 0, sy: 0, side: 512 });
  });

  it("halves the crop at 2x zoom, keeping it centered", () => {
    expect(centerCropRegion(1024, 1024, ZOOM_2X)).toEqual({
      sx: 256,
      sy: 256,
      side: 512,
    });
  });

  it("stays centered at 2x zoom on a landscape frame", () => {
    const region = centerCropRegion(1024, 512, ZOOM_2X);
    expect(region).toEqual({ sx: 384, sy: 128, side: 256 });
    // The crop's center is still the frame's center on both axes.
    expect(region.sx + region.side / 2).toBe(512);
    expect(region.sy + region.side / 2).toBe(256);
  });

  it("ignores a zoom below 1 rather than cropping outside the frame", () => {
    expect(centerCropRegion(1024, 512, 0.5)).toEqual(
      centerCropRegion(1024, 512),
    );
  });
});

describe("mapCropBoxToFrame", () => {
  it("maps the full crop onto the centered square of the frame", () => {
    const box = mapCropBoxToFrame(
      { xmin: 0, ymin: 0, xmax: 1, ymax: 1 },
      1024,
      512,
    );
    expect(box).toEqual({ xmin: 0.25, ymin: 0, xmax: 0.75, ymax: 1 });
  });

  it("keeps a centered box centered", () => {
    const box = mapCropBoxToFrame(
      { xmin: 0.25, ymin: 0.25, xmax: 0.75, ymax: 0.75 },
      1024,
      512,
    );
    expect(box.xmin + box.xmax).toBeCloseTo(1);
    expect(box.ymin + box.ymax).toBeCloseTo(1);
    // Half the crop's 512px side is 256px, an eighth of the 1024px frame.
    expect(box.xmax - box.xmin).toBeCloseTo(0.25);
    expect(box.ymax - box.ymin).toBeCloseTo(0.5);
  });

  it("is the identity on a square frame", () => {
    const box = { xmin: 0.1, ymin: 0.2, xmax: 0.6, ymax: 0.9 };
    expect(mapCropBoxToFrame(box, 512, 512)).toEqual(box);
  });

  it("maps a 2x-zoomed crop onto the middle quarter of a square frame", () => {
    // At 2x the crop is the centered half of the frame, so a box filling the
    // crop covers 0.25..0.75 of the frame on both axes.
    const box = mapCropBoxToFrame(
      { xmin: 0, ymin: 0, xmax: 1, ymax: 1 },
      1024,
      1024,
      ZOOM_2X,
    );
    expect(box).toEqual({ xmin: 0.25, ymin: 0.25, xmax: 0.75, ymax: 0.75 });
  });

  it("halves a 2x-zoomed detection's apparent size versus 1x", () => {
    // The same box in crop space describes a physically smaller region of the
    // frame at 2x, which is what makes a distant vehicle fill more of the
    // model's input.
    const cropBox = { xmin: 0.4, ymin: 0.4, xmax: 0.6, ymax: 0.6 };
    const wide = mapCropBoxToFrame(cropBox, 1024, 1024);
    const zoomed = mapCropBoxToFrame(cropBox, 1024, 1024, ZOOM_2X);
    expect(zoomed.xmax - zoomed.xmin).toBeCloseTo((wide.xmax - wide.xmin) / 2);
    expect(zoomed.ymax - zoomed.ymin).toBeCloseTo((wide.ymax - wide.ymin) / 2);
    // Both stay centered on the frame's center.
    expect(zoomed.xmin + zoomed.xmax).toBeCloseTo(1);
    expect(zoomed.ymin + zoomed.ymax).toBeCloseTo(1);
  });

  it("maps a portrait frame's crop onto its vertical center", () => {
    const box = mapCropBoxToFrame(
      { xmin: 0, ymin: 0, xmax: 1, ymax: 1 },
      480,
      640,
    );
    expect(box).toEqual({ xmin: 0, ymin: 0.125, xmax: 1, ymax: 0.875 });
  });
});

describe("cropRect", () => {
  it("pads the box and maps it to pixel coordinates", () => {
    // Box 0.4..0.6 in a 1000x500 frame; 15% of the 0.2-wide box = 0.03 pad.
    const rect = cropRect(
      { xmin: 0.4, ymin: 0.4, xmax: 0.6, ymax: 0.6 },
      1000,
      500,
    );
    expect(rect).toBeDefined();
    expect(rect?.sx).toBe(370); // (0.4 - 0.03) * 1000
    expect(rect?.sy).toBe(185); // (0.4 - 0.03) * 500
    expect(rect?.sw).toBe(260); // (0.63 - 0.37) * 1000
    expect(rect?.sh).toBe(130); // (0.63 - 0.37) * 500
  });

  it("clamps the padded rect to the frame edges", () => {
    const rect = cropRect(
      { xmin: 0, ymin: 0, xmax: 0.1, ymax: 0.1 },
      1000,
      1000,
    );
    expect(rect?.sx).toBe(0);
    expect(rect?.sy).toBe(0);
  });

  it("downscales so the long edge never exceeds CROP_MAX_EDGE", () => {
    const rect = cropRect({ xmin: 0, ymin: 0, xmax: 1, ymax: 0.5 }, 2000, 2000);
    expect(rect).toBeDefined();
    expect(Math.max(rect!.resizeWidth, rect!.resizeHeight)).toBe(CROP_MAX_EDGE);
    // Aspect ratio preserved: source is 2000x~1150, wider than tall.
    expect(rect!.resizeWidth).toBeGreaterThan(rect!.resizeHeight);
  });

  it("never upscales a crop smaller than CROP_MAX_EDGE", () => {
    const rect = cropRect(
      { xmin: 0.4, ymin: 0.4, xmax: 0.5, ymax: 0.5 },
      640,
      480,
    );
    expect(rect!.resizeWidth).toBe(rect!.sw);
    expect(rect!.resizeHeight).toBe(rect!.sh);
  });

  it("returns undefined for a degenerate box", () => {
    expect(
      cropRect({ xmin: 0.5, ymin: 0.5, xmax: 0.5, ymax: 0.5 }, 0, 0),
    ).toBeUndefined();
  });
});

describe("topDetectionIndex", () => {
  const detection = (score: number): RawDetection => ({
    label: "police",
    score,
    box: { xmin: 0.1, ymin: 0.1, xmax: 0.2, ymax: 0.2 },
  });

  it("returns the index of the highest-scoring detection", () => {
    expect(
      topDetectionIndex([detection(0.7), detection(0.9), detection(0.8)]),
    ).toBe(1);
  });

  it("returns undefined for an empty array", () => {
    expect(topDetectionIndex([])).toBeUndefined();
  });
});

describe("ensureCapacity", () => {
  it("returns the same buffer untouched when capacity already suffices", () => {
    const buffer = new Uint8Array(8);
    expect(ensureCapacity(buffer, 4, 8)).toBe(buffer);
    expect(ensureCapacity(buffer, 4, 6)).toBe(buffer);
  });

  it("preserves the written bytes when growing", () => {
    const buffer = Uint8Array.from([1, 2, 3, 4]);
    const grown = ensureCapacity(buffer, 4, 5);
    expect(grown).not.toBe(buffer);
    expect(Array.from(grown.subarray(0, 4))).toEqual([1, 2, 3, 4]);
    expect(grown.byteLength).toBeGreaterThanOrEqual(5);
  });

  it("copies only the loaded prefix, not stale bytes past it", () => {
    const buffer = Uint8Array.from([1, 2, 9, 9]);
    const grown = ensureCapacity(buffer, 2, 5);
    expect(Array.from(grown.subarray(0, 2))).toEqual([1, 2]);
    expect(grown[2]).toBe(0);
  });

  it("at least doubles so repeated growth stays amortized-linear", () => {
    const grown = ensureCapacity(new Uint8Array(100), 100, 101);
    expect(grown.byteLength).toBe(200);
  });

  it("jumps straight to needed when doubling is not enough", () => {
    const grown = ensureCapacity(new Uint8Array(4), 4, 100);
    expect(grown.byteLength).toBe(100);
  });

  it("grows from an empty buffer, the no-Content-Length starting state", () => {
    const grown = ensureCapacity(new Uint8Array(0), 0, 3);
    expect(grown.byteLength).toBe(3);
  });
});

describe("isWorkerResponse detections crop", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const detections = [
    {
      label: "police",
      score: 0.9,
      box: { xmin: 0.1, ymin: 0.1, xmax: 0.3, ymax: 0.3 },
    },
  ];
  const timing = { preprocessMs: 1, inferenceMs: 2, decodeMs: 3 };

  it("accepts a detections message without a crop", () => {
    expect(isWorkerResponse({ type: "detections", detections, timing })).toBe(
      true,
    );
  });

  it("accepts a detections message with a valid crop", () => {
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    const crop = { image: new FakeImageBitmap(), detectionIndex: 0 };
    expect(
      isWorkerResponse({ type: "detections", detections, timing, crop }),
    ).toBe(true);
  });

  it("rejects a crop whose image is not an ImageBitmap", () => {
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    const crop = { image: {}, detectionIndex: 0 };
    expect(
      isWorkerResponse({ type: "detections", detections, timing, crop }),
    ).toBe(false);
  });

  it("does not throw where ImageBitmap is undefined", () => {
    const crop = { image: new FakeImageBitmap(), detectionIndex: 0 };
    expect(
      isWorkerResponse({ type: "detections", detections, timing, crop }),
    ).toBe(false);
  });
});
