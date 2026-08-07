import { track } from "@vercel/analytics";
import type { DetectionModel } from "@/lib/detectionModels";
import { isStandalone } from "@/lib/pwaInstall";
import {
  createScanClock,
  SCAN_REPORT_MIN_MS,
  toBucketedMinutes,
} from "@/lib/scanClock";
import type { DetectionErrorCode } from "@/workers/detection/types";
import { ERROR_DETAIL_MAX_LENGTH, TIMING_BUCKET_MS } from "./consts";

export * from "./consts";

/**
 * Milliseconds to seconds, rounded to the nearest half. Coarse on purpose, so a
 * timing says how fast a device is without the noise of an exact number.
 */
const toBucketedSeconds = (ms: number): number =>
  Math.round(ms / TIMING_BUCKET_MS) / 2;

/**
 * The detection pipeline's analytics sink. The pump reports what happened and
 * this decides what to emit, so every once-per-page-load gate lives in one place
 * rather than a ref per event. That gating is load-bearing: the periodic worker
 * recycle produces repeat load and ready events for the same page load.
 */
export type DetectionTelemetry = {
  /** The weights started loading; `fromCache` feeds the later ready event. */
  modelLoadStart: (fromCache: boolean) => void;
  /** The weights finished streaming over the network (real downloads only). */
  modelDownloaded: (durationMs: number) => void;
  /** The session is built and the worker can scan. */
  modelReady: () => void;
  /** One detections result completed, with its measured times. */
  result: (timing: { inferenceMs: number; roundTripMs: number }) => void;
  /** A detection failure reached the user, with an optional platform cause. */
  error: (code: DetectionErrorCode | "WORKER_CRASHED", detail?: string) => void;
  /** The worker went silent (mid-scan or mid-load) and was recycled to recover. */
  workerHung: () => void;
  /** The pump entered its running state; starts the scanning clock. */
  scanningStarted: () => void;
  /** The pump left its running state; stops the scanning clock. */
  scanningStopped: () => void;
  /**
   * Report the drive's scanned time and mark it reported, which is what keeps the
   * hidden and unload listeners from double-counting one drive. An OS kill fires
   * neither and reports nothing, leaving that session to the crash sentinel.
   */
  reportScanSession: () => void;
};

/**
 * Builds the sink for one page load, bound to the running model so download
 * events name the revision that reached the device, which is the only signal
 * that makes a bad rollout visible before it errors.
 */
export const createDetectionTelemetry = (
  model: DetectionModel,
): DetectionTelemetry => {
  /** One-shot events already emitted this page load. */
  const fired = new Set<string>();
  /** Fire `emit` at most once per page load under `key`. */
  const once = (key: string, emit: () => void) => {
    if (fired.has(key)) {
      return;
    }
    fired.add(key);
    emit();
  };
  let modelFromCache = false;
  // Scanning time, not page time: the pump reports its running window, so the
  // settings panel and a hidden page are excluded.
  const scanClock = createScanClock();

  return {
    modelLoadStart: (fromCache) => {
      modelFromCache = fromCache;
    },
    modelDownloaded: (durationMs) => {
      // Which model reached this device and how long the bytes took. A device
      // whose cache never sticks would re-download on every recycle, so the gate
      // keeps the count at one per load.
      once("model_downloaded", () => {
        track("model_downloaded", {
          model: model.slug,
          revision: model.revision,
          seconds: Math.round(durationMs / 1_000),
        });
      });
    },
    modelReady: () => {
      // With no backend, the only view into the runtime cache's hit rate, which
      // is the difference between an instant start and a long wait.
      once("model_ready", () => {
        track("model_ready", { fromCache: modelFromCache });
      });
    },
    result: ({ inferenceMs, roundTripMs }) => {
      // The one event saying every startup gate cleared: intro dismissed, camera
      // granted, model loaded, frame through inference. Carries the cold numbers
      // a steady-state measurement never sees.
      once("first_result", () => {
        track("first_inference", { seconds: toBucketedSeconds(inferenceMs) });
        track("first_round_trip", { seconds: toBucketedSeconds(roundTripMs) });
      });
    },
    workerHung: () => {
      // A GPU that wedges again after the recycle would otherwise report every
      // reply-timeout window for the whole drive.
      once("worker_hung", () => {
        track("worker_hung");
      });
    },
    error: (code, detail) => {
      // Only for the codes that carry a cause, truncated because a platform
      // string is not something to hand an analytics property unbounded.
      track("error", {
        code,
        ...(detail && { detail: detail.slice(0, ERROR_DETAIL_MAX_LENGTH) }),
      });
    },
    scanningStarted: () => {
      scanClock.start();
    },
    scanningStopped: () => {
      scanClock.stop();
    },
    reportScanSession: () => {
      const scannedMs = scanClock.takeUnreportedMs(SCAN_REPORT_MIN_MS);
      if (scannedMs === 0) {
        return;
      }
      track("scan_session", {
        minutes: toBucketedMinutes(scannedMs),
        // The `pwa_installed` event counts installs, never use, so this is the
        // only read on whether drives happen in the PWA or a browser tab.
        standalone: isStandalone(),
      });
    },
  };
};
