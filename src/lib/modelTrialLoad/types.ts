import type { LoadedSummary } from "@/workers/detection/types";

/**
 * The slice of the Worker interface the trial load drives, so tests can hand
 * in a fake without jsdom being able to construct a real one.
 */
export type TrialWorkerLike = {
  postMessage: (message: unknown) => void;
  terminate: () => void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

/**
 * How a trial load settled. `loaded` is the worker's report of what the
 * checkpoint turned out to hold (head width and classes), when it sent one.
 * `reason` is a human-readable story for the add UI, never a code to branch
 * on.
 */
export type TrialLoadResult =
  | { ok: true; loaded?: LoadedSummary }
  | { ok: false; reason: string };

/** Options for trialLoadModel; every field is a seam or a progress tap. */
export type TrialLoadOptions = {
  createWorker?: () => TrialWorkerLike;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};
