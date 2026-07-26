import {
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

/**
 * The one-and-only analytics summary for this session, or undefined when it
 * isn't due: the window has yet to fill (a session that scanned only a handful
 * of times reports nothing rather than a median of two samples), or this
 * session already reported. Claiming it marks the session reported in
 * sessionStorage, so the caller may fire the events unconditionally on a
 * defined result, and a later full window (the drive keeps scanning long past
 * ten) never reports again. Session-scoped by construction: a new tab starts
 * fresh, which is the granularity the events are counted at.
 */
export const takeTimingReport = (
  history: TimingHistory,
): TimingReport | undefined => {
  if (
    history.roundTrip.length < TIMING_HISTORY_LIMIT ||
    history.inference.length < TIMING_HISTORY_LIMIT
  ) {
    return undefined;
  }
  try {
    if (window.sessionStorage.getItem(TIMING_ANALYTICS_STORAGE_KEY) !== null) {
      return undefined;
    }
    window.sessionStorage.setItem(TIMING_ANALYTICS_STORAGE_KEY, "true");
  } catch {
    // Storage unavailable, so "already reported" cannot be recorded or read.
    // Report nothing rather than risk an event on every scan past the tenth.
    return undefined;
  }
  return {
    roundTrip: medianSeconds(history.roundTrip),
    inference: medianSeconds(history.inference),
  };
};
