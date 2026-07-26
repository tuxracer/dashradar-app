import {
  TIMING_BUCKET_MS,
  TIMING_HISTORY_LIMIT,
  TIMING_HISTORY_STORAGE_KEY,
} from "./consts";
import { isTimingHistory } from "./types";
import type { TimingHistory, TimingSample } from "./types";

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
}: TimingSample): void => {
  if (!Number.isFinite(roundTripMs) || !Number.isFinite(inferenceMs)) {
    return;
  }
  const history = readTimingHistory();
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
};
