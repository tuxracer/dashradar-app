import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  centerCropRegion,
  cropRect,
  decodeDetections,
  ensureCapacity,
  mapCropBoxToFrame,
  preprocess,
  resolveLoadedModel,
  topDetectionIndex,
} from "@/workers/detection/inference";
import {
  CROP_MAX_EDGE,
  IMAGENET_MEAN,
  IMAGENET_STD,
  INPUT_SIZE,
  ZOOM_2X,
} from "@/workers/detection/consts";
import {
  isDetectionError,
  isWorkerRequest,
  isWorkerResponse,
} from "@/workers/detection/types";
import {
  installWasmMemoryCapture,
  wasmHeapBytes,
} from "@/workers/detection/wasmMemory";
import { DEFAULT_MODEL } from "@/lib/detectionModels";
import type { LoadedModel } from "@/lib/detectionModels";
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

const entry = {
  id: "url-id",
  owner: "someone",
  slug: "some-repo",
  revision: "abc123",
  file: "onnx/model.onnx",
};

describe("isWorkerRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts load without a model entry", () => {
    expect(isWorkerRequest({ type: "load" })).toBe(true);
  });

  it("accepts load with a valid model entry", () => {
    expect(isWorkerRequest({ type: "load", model: entry })).toBe(true);
  });

  it("rejects load with a malformed model entry", () => {
    expect(isWorkerRequest({ type: "load", model: { id: "x" } })).toBe(false);
    expect(isWorkerRequest({ type: "load", model: "url" })).toBe(false);
  });

  it("accepts detect with and without the includeCrop flag", () => {
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    const frame = new FakeImageBitmap();
    expect(isWorkerRequest({ type: "detect", frame })).toBe(true);
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
    expect(
      isWorkerResponse({
        type: "ready",
        classes: [{ index: 1, label: "police" }],
      }),
    ).toBe(true);
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

  it("accepts ready with and without a loaded summary", () => {
    expect(isWorkerResponse({ type: "ready" })).toBe(true);
    expect(
      isWorkerResponse({
        type: "ready",
        loaded: { headWidth: 2, classes: [{ index: 1, label: "police" }] },
      }),
    ).toBe(true);
    expect(
      isWorkerResponse({ type: "ready", loaded: { headWidth: "2" } }),
    ).toBe(false);
  });

  it("accepts a wasm heap size on the replies that report one", () => {
    expect(isWorkerResponse({ type: "ready", wasmHeapBytes: 1024 })).toBe(true);
    expect(
      isWorkerResponse({
        type: "detections",
        detections: [],
        timing: { preprocessMs: 1, inferenceMs: 2, decodeMs: 3 },
        wasmHeapBytes: 1024,
      }),
    ).toBe(true);
    expect(
      isWorkerResponse({
        type: "scan-skipped",
        gateMs: 1,
        delta: 0,
        wasmHeapBytes: 1024,
      }),
    ).toBe(true);
    expect(isWorkerResponse({ type: "ready", wasmHeapBytes: "big" })).toBe(
      false,
    );
    expect(
      isWorkerResponse({
        type: "scan-skipped",
        gateMs: 1,
        delta: 0,
        wasmHeapBytes: "big",
      }),
    ).toBe(false);
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
});

describe("wasmHeapBytes", () => {
  const NativeMemory = WebAssembly.Memory;
  afterAll(() => {
    // Undo the capture's global patch so nothing outside this suite runs on
    // the recording subclass.
    (WebAssembly as { Memory: typeof WebAssembly.Memory }).Memory =
      NativeMemory;
  });

  const PAGE_BYTES = 65_536;

  // One sequential test on purpose: the module records into shared state, so
  // the empty reading is only observable before anything has been captured.
  it("reports the largest captured memory at its current size", () => {
    expect(wasmHeapBytes()).toBeUndefined();
    installWasmMemoryCapture();
    const heap = new WebAssembly.Memory({ initial: 2, maximum: 4 });
    expect(wasmHeapBytes()).toBe(2 * PAGE_BYTES);
    // Growth must show up in later readings, not the size at creation.
    heap.grow(1);
    expect(wasmHeapBytes()).toBe(3 * PAGE_BYTES);
    // A zero-page feature probe (the runtime creates these) must not shadow
    // the real heap.
    new WebAssembly.Memory({ initial: 0, maximum: 0 });
    expect(wasmHeapBytes()).toBe(3 * PAGE_BYTES);
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

/** The shipping entry as a loaded 2-wide session reports it. */
const POLICE_MODEL: LoadedModel = {
  ...DEFAULT_MODEL,
  headWidth: 2,
  classes: [{ index: 1, label: "police" }],
};

/** A two-class model, for driving decode past the single class that ships. */
const TWO_CLASS_MODEL: LoadedModel = {
  id: "two-class",
  owner: "tuxracer",
  slug: "two-class",
  revision: "v1",
  file: "onnx/model.onnx",
  headWidth: 3,
  classes: [
    {
      index: 1,
      label: "police",
    },
    { index: 2, label: "person" },
  ],
};

/** A `labels` output shape for a head of this width: [batch, queries, C]. */
const labelsDims = (headWidth: number): readonly number[] => [1, 4, headWidth];

describe("resolveLoadedModel", () => {
  /**
   * Runs a resolve that should be rejected and hands back the thrown error, or
   * undefined when it returned instead. The undefined is what makes these
   * assertions fail if the guard they cover is ever removed.
   */
  const resolveError = (dims: readonly number[]): unknown => {
    try {
      resolveLoadedModel(dims, DEFAULT_MODEL);
      return undefined;
    } catch (error) {
      return error;
    }
  };

  it("takes the width off the session rather than from anywhere declared", () => {
    expect(resolveLoadedModel(labelsDims(7), DEFAULT_MODEL).headWidth).toBe(7);
  });

  it("names the classes from the map stamped into the weights", () => {
    const loaded = resolveLoadedModel(labelsDims(2), DEFAULT_MODEL, {
      props: { names: JSON.stringify({ 1: "police" }) },
    });

    expect(loaded.classes).toEqual([{ index: 1, label: "police" }]);
    expect(loaded.id).toBe(DEFAULT_MODEL.id);
  });

  it("still names every slot when the weights name nothing", () => {
    // An unstamped export has to keep detecting: the meter reads scores, not
    // labels, so the cost is the words on the card and nothing else.
    const loaded = resolveLoadedModel(labelsDims(3), DEFAULT_MODEL);

    expect(loaded.classes.map((entry) => entry.index)).toEqual([1, 2]);
  });

  it("drops a stamped class the loaded head cannot hold", () => {
    // The one way a names map and its own graph can disagree. Reading logit 5
    // of a 2-wide head lands outside the tensor and scores NaN, so the class
    // never wins and its absence is silent; dropping it at load is not.
    const loaded = resolveLoadedModel(labelsDims(2), DEFAULT_MODEL, {
      props: { names: JSON.stringify({ 1: "police", 5: "ghost" }) },
    });

    expect(loaded.classes.map((entry) => entry.label)).toEqual(["police"]);
  });

  it("rejects a labels output that is not shaped like a classification head", () => {
    // Two dimensions cannot carry a per-query stride, so there is no width to
    // read and every later offset would be invented.
    const thrown = resolveError([1, 300]);

    expect(isDetectionError(thrown)).toBe(true);
    expect(isDetectionError(thrown) && thrown.code).toBe("MODEL_LOAD_FAILED");
  });

  it("rejects a head with no room for a class beside the background slot", () => {
    const thrown = resolveError(labelsDims(1));

    expect(isDetectionError(thrown) && thrown.code).toBe("MODEL_LOAD_FAILED");
  });
});

describe("decodeDetections", () => {
  it("emits a police detection with the sigmoid score and clamped xyxy box", () => {
    // One query, high class-1 logit, cxcywh centered box within bounds.
    const labels = makeLabels([[-8, 4]]);
    const boxes = makeBoxes([[0.5, 0.5, 0.4, 0.2]]);

    const detections = decodeDetections(boxes, labels, 0.5, POLICE_MODEL);

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

    const detections = decodeDetections(boxes, labels, 0.5, POLICE_MODEL);

    expect(detections[0].box.xmin).toBe(0);
    expect(detections[0].box.ymin).toBe(0);
    expect(detections[0].box.xmax).toBeCloseTo(0.4, 6);
    expect(detections[0].box.ymax).toBeCloseTo(0.4, 6);
  });

  it("drops a query whose police score is below threshold", () => {
    // sigmoid(-1) ~= 0.269, under the 0.5 threshold.
    const labels = makeLabels([[-8, -1]]);
    const boxes = makeBoxes([[0.5, 0.5, 0.4, 0.2]]);

    expect(decodeDetections(boxes, labels, 0.5, POLICE_MODEL)).toHaveLength(0);
  });

  it("ignores the class-0 slot entirely", () => {
    // Strong class-0 signal, negative class-1: no detection should surface.
    const labels = makeLabels([[10, -8]]);
    const boxes = makeBoxes([[0.5, 0.5, 0.4, 0.2]]);

    expect(decodeDetections(boxes, labels, 0.5, POLICE_MODEL)).toHaveLength(0);
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

    const detections = decodeDetections(boxes, labels, 0.5, POLICE_MODEL);

    expect(detections).toHaveLength(2);
    expect(detections.map((detection) => detection.score)).toEqual([
      sigmoid(4),
      sigmoid(5),
    ]);
  });

  it("drops a query whose box is not finite instead of emitting NaN geometry", () => {
    // dets and labels are independent tensors, so an fp16 pathology can pair
    // a valid above-threshold score with a NaN box. clamp01 passes NaN
    // through, and an emitted NaN box would ride a possibly frame-strongest
    // score into geometry nothing downstream can draw, crop, or match.
    const labels = makeLabels([
      [-8, 4],
      [-8, 5],
    ]);
    const boxes = makeBoxes([
      [0.5, 0.5, 0.4, 0.2],
      [NaN, 0.5, 0.4, 0.2],
    ]);

    const detections = decodeDetections(boxes, labels, 0.5, POLICE_MODEL);

    expect(detections).toHaveLength(1);
    expect(detections[0].score).toBeCloseTo(sigmoid(4), 6);
  });

  it("keeps a confident detection however small its box", () => {
    const labels = makeLabels([[-8, 4]]);
    // Two input pixels on a side. The old decode dropped anything under 15,
    // on the reasoning that a patrol car and a civilian car are
    // indistinguishable that small. A general detector has no such problem:
    // a distant object is still the object.
    const side = 2 / INPUT_SIZE;
    const boxes = makeBoxes([[0.5, 0.5, side, side]]);

    expect(decodeDetections(boxes, labels, 0.5, POLICE_MODEL)).toHaveLength(1);
  });

  it("labels a query with its highest-scoring class", () => {
    // One query, 3-wide head: background, weak police, strong person.
    const labels = makeLabels([[-8, 1, 4]]);
    const boxes = makeBoxes([[0.5, 0.5, 0.4, 0.2]]);

    const detections = decodeDetections(boxes, labels, 0.5, TWO_CLASS_MODEL);

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

    const detections = decodeDetections(boxes, labels, 0.5, TWO_CLASS_MODEL);

    expect(detections.map((d) => d.label)).toEqual(["police", "person"]);
  });

  it("drops a query whose best class is still below threshold", () => {
    // sigmoid(-1) ~= 0.269 and sigmoid(-2) ~= 0.119, both under 0.5.
    const labels = makeLabels([[-8, -1, -2]]);
    const boxes = makeBoxes([[0.5, 0.5, 0.4, 0.2]]);

    expect(decodeDetections(boxes, labels, 0.5, TWO_CLASS_MODEL)).toHaveLength(
      0,
    );
  });

  it("rejects a labels tensor that does not fit the model's stride", () => {
    // Two logits per query against a model whose stride is 3: from the second
    // query on, every class would be read at the wrong offset, so this must
    // fail loudly rather than emit plausible garbage.
    const labels = makeLabels([
      [-8, 4],
      [-8, 4],
    ]);
    const boxes = makeBoxes([
      [0.5, 0.5, 0.4, 0.2],
      [0.2, 0.2, 0.2, 0.2],
    ]);

    let thrown: unknown;
    try {
      decodeDetections(boxes, labels, 0.5, TWO_CLASS_MODEL);
    } catch (error) {
      thrown = error;
    }

    expect(isDetectionError(thrown)).toBe(true);
    expect(isDetectionError(thrown) && thrown.code).toBe("MODEL_LOAD_FAILED");
  });

  it("reads a sparse table at the indices it names", () => {
    // A 5-wide head where only slots 1 and 4 are named. Slot 3 carries the
    // strongest logit in the tensor and must be ignored entirely: this is the
    // case a dense table could not express.
    const sparse: LoadedModel = {
      ...TWO_CLASS_MODEL,
      headWidth: 5,
      classes: [
        {
          index: 1,
          label: "police",
        },
        {
          index: 4,
          label: "person",
        },
      ],
    };
    const labels = makeLabels([[-8, -8, -8, 9, 4]]);
    const boxes = makeBoxes([[0.5, 0.5, 0.4, 0.2]]);

    const detections = decodeDetections(boxes, labels, 0.5, sparse);

    expect(detections).toHaveLength(1);
    expect(detections[0].label).toBe("person");
    expect(detections[0].score).toBeCloseTo(sigmoid(4), 6);
  });

  it("returns no detections for an empty output rather than failing the guard", () => {
    expect(
      decodeDetections(
        new Float32Array(0),
        new Float32Array(0),
        0.5,
        POLICE_MODEL,
      ),
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
