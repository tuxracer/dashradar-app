import { describe, expect, it, vi } from "vitest";
import type { WorkerResponse } from "@/workers/detection/types";
import { trialLoadModel } from "@/lib/modelTrialLoad";
import type { TrialWorkerLike } from "@/lib/modelTrialLoad";

const entry = {
  id: "url-id",
  owner: "someone",
  slug: "some-repo",
  revision: "abc123",
  file: "onnx/model.onnx",
};

/** Hand-driven fake worker: the test emits responses, the lib reacts. */
const makeFakeWorker = () => {
  const worker: TrialWorkerLike & { sent: unknown[] } = {
    sent: [],
    onmessage: null,
    onerror: null,
    postMessage: (message) => {
      worker.sent.push(message);
    },
    terminate: vi.fn(),
  };
  const emit = (response: WorkerResponse) => {
    worker.onmessage?.({ data: response } as MessageEvent<unknown>);
  };
  return { worker, emit };
};

describe("trialLoadModel", () => {
  it("sends load with the entry and resolves ok on ready", async () => {
    const { worker, emit } = makeFakeWorker();
    const result = trialLoadModel(entry, { createWorker: () => worker });
    expect(worker.sent).toEqual([{ type: "load", model: entry }]);
    emit({
      type: "ready",
      loaded: { headWidth: 2, classes: [{ index: 1, label: "police" }] },
    });
    await expect(result).resolves.toEqual({
      ok: true,
      loaded: { headWidth: 2, classes: [{ index: 1, label: "police" }] },
    });
    expect(worker.terminate).toHaveBeenCalled();
  });

  it("reports progress fractions", async () => {
    const { worker, emit } = makeFakeWorker();
    const fractions: number[] = [];
    const result = trialLoadModel(entry, {
      createWorker: () => worker,
      onProgress: (fraction) => fractions.push(fraction),
    });
    emit({
      type: "model-progress",
      progress: { file: "model.onnx", loaded: 25, total: 100 },
    });
    emit({ type: "ready" });
    await result;
    expect(fractions).toEqual([0.25]);
  });

  it("resolves not-ok on worker-error, preferring the probe's session error", async () => {
    const { worker, emit } = makeFakeWorker();
    const result = trialLoadModel(entry, { createWorker: () => worker });
    emit({
      type: "backend-probe",
      probe: {
        sessionError: "Failed to create session: input shape mismatch",
        graphCapture: false,
        crossOriginIsolated: true,
        threads: 4,
      },
    });
    emit({ type: "worker-error", code: "MODEL_LOAD_FAILED" });
    const settled = await result;
    expect(settled.ok).toBe(false);
    if (!settled.ok) {
      expect(settled.reason).toContain("input shape mismatch");
    }
    expect(worker.terminate).toHaveBeenCalled();
  });

  it("resolves not-ok with the bare code when no probe arrived", async () => {
    const { worker, emit } = makeFakeWorker();
    const result = trialLoadModel(entry, { createWorker: () => worker });
    emit({ type: "worker-error", code: "MODEL_LOAD_FAILED" });
    await expect(result).resolves.toEqual({
      ok: false,
      reason: "MODEL_LOAD_FAILED",
    });
  });

  it("terminates and resolves not-ok on abort", async () => {
    const { worker } = makeFakeWorker();
    const controller = new AbortController();
    const result = trialLoadModel(entry, {
      createWorker: () => worker,
      signal: controller.signal,
    });
    controller.abort();
    const settled = await result;
    expect(settled.ok).toBe(false);
    expect(worker.terminate).toHaveBeenCalled();
  });
});
