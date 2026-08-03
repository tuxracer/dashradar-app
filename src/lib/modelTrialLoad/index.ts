import type { DetectionModel } from "@/lib/detectionModels";
import { isWorkerResponse } from "@/workers/detection/types";
import type {
  TrialLoadOptions,
  TrialLoadResult,
  TrialWorkerLike,
} from "./types";

export * from "./types";

/** The real detection worker, same construction as DetectionContext's. */
const createDetectionWorker = (): TrialWorkerLike =>
  new Worker(new URL("../../workers/detection/index.ts", import.meta.url), {
    type: "module",
  });

/**
 * Prove a candidate model entry actually runs on this device, by doing the
 * real thing: a fresh detection worker downloads the weights, builds a WebGPU
 * session, and runs it once. That is the whole compatibility contract, so a
 * wrong input size, an incompatible head, or an unsupported op fails here
 * with a reason instead of stranding the app after a reload. The download
 * goes through the page's service worker (or the worker's dev cache), so a
 * successful trial has already cached the weights: the trial IS the cache
 * fill.
 *
 * The worker is terminated however this settles. Never rejects; every failure
 * is a result with a reason. An abort terminates the worker mid-download and
 * settles not-ok.
 */
export const trialLoadModel = (
  model: DetectionModel,
  {
    createWorker = createDetectionWorker,
    onProgress,
    signal,
  }: TrialLoadOptions = {},
): Promise<TrialLoadResult> =>
  new Promise((resolve) => {
    const worker = createWorker();
    // The probe's sessionError names the real cause when a load fails; the
    // worker sends it just before the terminal worker-error.
    let sessionError: string | undefined;
    const settle = (result: TrialLoadResult) => {
      worker.terminate();
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = () => {
      settle({ ok: false, reason: "Cancelled" });
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort);
    worker.onmessage = (event) => {
      const response = event.data;
      if (!isWorkerResponse(response)) {
        return;
      }
      if (response.type === "model-progress" && response.progress.total > 0) {
        onProgress?.(response.progress.loaded / response.progress.total);
      }
      if (response.type === "backend-probe") {
        sessionError = response.probe.sessionError;
      }
      if (response.type === "ready") {
        settle({ ok: true, loaded: response.loaded });
      }
      if (response.type === "worker-error") {
        settle({
          ok: false,
          reason: sessionError ?? response.detail ?? response.code,
        });
      }
    };
    worker.onerror = () => {
      settle({ ok: false, reason: "The detection worker crashed" });
    };
    worker.postMessage({ type: "load", model });
  });
