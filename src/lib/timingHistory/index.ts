import {
  LATE_TIMING_AFTER_MS,
  LATE_TIMING_ANALYTICS_STORAGE_KEY,
  TIMING_ANALYTICS_STORAGE_KEY,
  TIMING_BUCKET_MS,
  TIMING_HISTORY_LIMIT,
  TIMING_HISTORY_STORAGE_KEY,
} from "./consts";
import { isTimingHistory } from "./types";
import type { TimingHistory, TimingReport, TimingSample } from "./types";

export * from "./consts";
export * from "./types";

/**
 * Milliseconds to seconds, rounded to the nearest half second: 1488 ms reads
 * as 1.5, 1986 ms as 2. Coarse on purpose, so a series shows how a stretch of
 * a drive paced without the noise of exact per-frame numbers.
 */
export const toBucketedSeconds = (ms: number): number => {
  return Math.round(ms / TIMING_BUCKET_MS) / 2;
};

/** A fresh empty history; a new object each call, so no caller shares arrays. */
const emptyHistory = (): TimingHistory => ({ roundTrip: [], inference: [] });

/**
 * The stored history, or an empty one when nothing is stored, the blob is
 * corrupt, or storage is unavailable (private mode, quota). sessionStorage
 * rather than localStorage: these are diagnostics for the drive in progress,
 * and a fresh tab should start from a clean window rather than inheriting
 * numbers from a session on another day or another build.
 */
export const readTimingHistory = (): TimingHistory => {
  try {
    const raw = window.sessionStorage.getItem(TIMING_HISTORY_STORAGE_KEY);
    if (raw === null) {
      return emptyHistory();
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isTimingHistory(parsed)) {
      return emptyHistory();
    }
    return parsed;
  } catch {
    return emptyHistory();
  }
};

/** Appends one sample, dropping the oldest once the window is full. */
const appendSample = (series: number[], seconds: number): number[] => {
  return [...series, seconds].slice(-TIMING_HISTORY_LIMIT);
};

/**
 * Record one scan's round-trip and inference times into the rolling window.
 * Called from DetectionContext's `detections` handler, so the two series stay
 * index-aligned: entry n of each is the same scan. A non-finite reading is
 * dropped rather than written, since a NaN would poison the whole window.
 * Best-effort: a storage failure leaves the stored history unchanged.
 */
export const recordTimings = ({
  roundTripMs,
  inferenceMs,
}: TimingSample): TimingHistory => {
  const history = readTimingHistory();
  if (!Number.isFinite(roundTripMs) || !Number.isFinite(inferenceMs)) {
    return history;
  }
  const next: TimingHistory = {
    roundTrip: appendSample(history.roundTrip, toBucketedSeconds(roundTripMs)),
    inference: appendSample(history.inference, toBucketedSeconds(inferenceMs)),
  };
  try {
    window.sessionStorage.setItem(
      TIMING_HISTORY_STORAGE_KEY,
      JSON.stringify(next),
    );
  } catch {
    // Private mode or quota pressure; the drive runs without the history.
  }
  return next;
};

/**
 * Median of a series, snapped back onto the half-second grid its samples sit
 * on. An even-length window averages its two middle samples, which can land
 * between buckets (1.5 and 2 average to 1.75); snapping keeps every reported
 * value one of the same handful the samples use, so the analytics facet stays
 * low-cardinality and comparable across devices. An empty series is 0.
 */
export const medianSeconds = (series: number[]): number => {
  if (series.length === 0) {
    return 0;
  }
  const sorted = [...series].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  return Math.round(median * 2) / 2;
};

/** Whether both series hold a full window, so their medians mean something. */
const isWindowFull = (history: TimingHistory): boolean =>
  history.roundTrip.length >= TIMING_HISTORY_LIMIT &&
  history.inference.length >= TIMING_HISTORY_LIMIT;

/**
 * Claims `key` for this session, returning false when it was already claimed
 * or when storage cannot answer. A session whose storage cannot record the
 * mark claims nothing and so reports nothing, rather than risk an event on
 * every scan for the rest of the drive.
 */
const claimOnce = (key: string): boolean => {
  try {
    if (window.sessionStorage.getItem(key) !== null) {
      return false;
    }
    window.sessionStorage.setItem(key, "true");
    return true;
  } catch {
    return false;
  }
};

/**
 * The session's early analytics summary, or undefined when it isn't due: the
 * window has yet to fill (a session that scanned once or twice reports nothing
 * rather than a median of its first reading), or this session already
 * reported. Claiming it marks the session reported in sessionStorage, so the
 * caller may fire the events unconditionally on a defined result, and a later
 * full window (the drive keeps scanning long past five) never reports again.
 * Session-scoped by construction: a new tab starts fresh, which is the
 * granularity the events are counted at.
 */
export const takeTimingReport = (
  history: TimingHistory,
): TimingReport | undefined => {
  if (!isWindowFull(history) || !claimOnce(TIMING_ANALYTICS_STORAGE_KEY)) {
    return undefined;
  }
  return {
    roundTrip: medianSeconds(history.roundTrip),
    inference: medianSeconds(history.inference),
  };
};

/**
 * The session's second summary, due once `scannedMs` of scanning has
 * accumulated ({@link LATE_TIMING_AFTER_MS}), or undefined when it isn't. Same
 * rolling window as the early report, which is the point: five scans in, that
 * window holds a cold device, and a quarter hour of continuous inference later
 * it holds the same device at whatever clock the thermal governor has settled
 * it to. The difference between the two reports is the fleet-wide view of
 * throttling, which the early report alone cannot show and which the pacing
 * floor and rest ratio are set against.
 *
 * The window-full check is not redundant with the elapsed one: a session can
 * cross fifteen minutes with a near-empty window after scanning, stopping, and
 * sitting on the settings panel or a stalled camera.
 */
export const takeLateTimingReport = (
  history: TimingHistory,
  scannedMs: number,
): TimingReport | undefined => {
  if (
    scannedMs < LATE_TIMING_AFTER_MS ||
    !isWindowFull(history) ||
    !claimOnce(LATE_TIMING_ANALYTICS_STORAGE_KEY)
  ) {
    return undefined;
  }
  return {
    roundTrip: medianSeconds(history.roundTrip),
    inference: medianSeconds(history.inference),
  };
};
