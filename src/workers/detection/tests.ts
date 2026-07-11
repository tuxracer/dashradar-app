import { describe, expect, it } from "vitest";
import { isWorkerResponse } from "@/workers/detection/types";

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
