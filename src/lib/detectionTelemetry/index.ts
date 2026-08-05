import { track } from "@vercel/analytics";
import type { DetectionModel } from "@/lib/detectionModels";
import { isStandalone } from "@/lib/pwaInstall";
import {
  createScanClock,
  SCAN_REPORT_MIN_MS,
  toBucketedMinutes,
} from "@/lib/scanClock";
import {
  recordTimings,
  takeLateTimingReport,
  takeTimingReport,
  toBucketedSeconds,
} from "@/lib/timingHistory";
import type { DetectionErrorCode } from "@/workers/detection/types";
import { ERROR_DETAIL_MAX_LENGTH } from "./consts";

export * from "./consts";

/**
 * The detection pipeline's analytics sink, extracted from the frame-pump code
 * so every once-per-page-load gate lives in one place instead of a ref per
 * event. The pump reports what happened (a load started, a result arrived);
 * this module decides what to emit. All gating is internal: the periodic
 * worker recycle produces repeat `ready` and load events for the same page
 * load, and none of them may re-fire a one-shot event.
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
   * Report the drive's scanned time so far and mark it reported. Called when
   * the page goes hidden or unloads; draining the clock keeps the two
   * listeners from double-counting one drive, and an OS kill (which fires
   * neither) deliberately reports nothing, leaving that session to the crash
   * sentinel.
   */
  reportScanSession: () => void;
};

/**
 * Builds the sink for one page load, bound to the model the session runs so
 * download events name the slug and revision that actually reached the device
 * (the only signal that makes a bad rollout visible before it errors).
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
  // Scanning time this page load, which is not page time: the pump reports
  // its running window, so the settings panel and a hidden page are excluded.
  // Read by the late timing report (drift under sustained load is what the
  // thermal budget turns on) and drained by reportScanSession.
  const scanClock = createScanClock();

  return {
    modelLoadStart: (fromCache) => {
      modelFromCache = fromCache;
    },
    modelDownloaded: (durationMs) => {
      // Which model actually reached this device, and how long the bytes took
      // to arrive. A device whose cache never sticks would re-download on
      // every worker recycle, so the gate keeps the count at one per load.
      once("model_downloaded", () => {
        track("model_downloaded", {
          model: model.slug,
          revision: model.revision,
          seconds: Math.round(durationMs / 1_000),
        });
      });
    },
    modelReady: () => {
      // Whether the session started from cached bytes or a fresh download.
      // With no backend there is no other view into the runtime cache's hit
      // rate, which is the difference between an instant start and a 54 MB
      // wait.
      once("model_ready", () => {
        track("model_ready", { fromCache: modelFromCache });
      });
    },
    result: ({ inferenceMs, roundTripMs }) => {
      // The one event that says every startup gate was cleared: intro
      // dismissed, camera granted, model loaded, and a frame made it through
      // inference. Carries the cold numbers (session compile, cold GPU) the
      // rolling medians below never see.
      once("first_result", () => {
        track("first_inference", { seconds: toBucketedSeconds(inferenceMs) });
        track("first_round_trip", { seconds: toBucketedSeconds(roundTripMs) });
      });
      // Roll the same two numbers into the sessionStorage window, so a
      // drive's recent pacing can be read back off the device afterwards.
      // Once the window first fills, report its medians: five scans in is
      // past the first-run costs and early enough that even a short session
      // reaches it. takeTimingReport is its own once-per-session guard.
      const timings = recordTimings({ roundTripMs, inferenceMs });
      const report = takeTimingReport(timings);
      if (report) {
        track("timing_round_trip", { seconds: report.roundTrip });
        track("timing_inference", { seconds: report.inference });
      }
      // The same window again, a quarter hour of scanning later. The early
      // report is by construction the coldest reading of the drive; the gap
      // between the two is the fleet-wide view of thermal drift on real dash
      // mounts. Also once per session, guarded by takeLateTimingReport.
      const lateReport = takeLateTimingReport(timings, scanClock.elapsedMs());
      if (lateReport) {
        track("timing_round_trip_late", { seconds: lateReport.roundTrip });
        track("timing_inference_late", { seconds: lateReport.inference });
      }
    },
    workerHung: () => {
      // Once per page load: a device whose GPU wedges again after the recycle
      // would otherwise report every reply-timeout window for the whole drive.
      once("worker_hung", () => {
        track("worker_hung");
      });
    },
    error: (code, detail) => {
      // The cause rides along only for codes that carry one (the GPUDevice
      // lost reason today), truncated because a platform string is not
      // something to hand an analytics property unbounded.
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
        // Whether the drive ran from the installed PWA or a browser tab. The
        // one-shot `pwa_installed` event counts installs, never use, so this
        // is the only read on which of the two the app is actually used from.
        standalone: isStandalone(),
      });
    },
  };
};
