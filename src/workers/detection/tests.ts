import { describe, expect, it } from "vitest";
import { decodeDetections } from "@/workers/detection/inference";
import { isWorkerResponse } from "@/workers/detection/types";

/** Build a `[1,queries,2]` logits buffer with per-query (class0, class1) pairs. */
const makeLabels = (pairs: readonly [number, number][]): Float32Array =>
  Float32Array.from(pairs.flat());

/** Build a `[1,queries,4]` cxcywh box buffer. */
const makeBoxes = (
  boxes: readonly [number, number, number, number][],
): Float32Array => Float32Array.from(boxes.flat());

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

describe("isWorkerResponse", () => {
  it("accepts every response variant", () => {
    expect(
      isWorkerResponse({
        type: "model-progress",
        progress: { file: "model.onnx", loaded: 10, total: 100 },
      }),
    ).toBe(true);
    expect(isWorkerResponse({ type: "ready", backend: "webgpu" })).toBe(true);
    expect(isWorkerResponse({ type: "ready", backend: "wasm" })).toBe(true);
    expect(isWorkerResponse({ type: "detections", detections: [] })).toBe(true);
    expect(
      isWorkerResponse({ type: "worker-error", code: "MODEL_LOAD_FAILED" }),
    ).toBe(true);
  });

  it("rejects malformed messages", () => {
    expect(isWorkerResponse(null)).toBe(false);
    expect(isWorkerResponse({ type: "ready", backend: "cuda" })).toBe(false);
    expect(isWorkerResponse({ type: "detections" })).toBe(false);
    expect(isWorkerResponse({ type: "worker-error", code: "NOPE" })).toBe(
      false,
    );
    expect(isWorkerResponse({ type: "model-progress", progress: {} })).toBe(
      false,
    );
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
});
