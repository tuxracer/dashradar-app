import { isArray, isNumber, isPlainObject } from "remeda";

/**
 * The last TIMING_HISTORY_LIMIT scans' round-trip and inference times, in
 * seconds rounded to the nearest half second, oldest first. The two series
 * move together: one scan appends one sample to each.
 */
export type TimingHistory = {
  roundTrip: number[];
  inference: number[];
};

/** One scan's raw timings, in milliseconds, as measured by DetectionContext. */
export type TimingSample = {
  roundTripMs: number;
  inferenceMs: number;
};

/**
 * The once-per-session analytics summary of a full window: each series' median,
 * in seconds on the same half-second grid as the samples.
 */
export type TimingReport = {
  roundTrip: number;
  inference: number;
};

/** Validates a parsed sessionStorage blob as a TimingHistory. */
export const isTimingHistory = (value: unknown): value is TimingHistory => {
  return (
    isPlainObject(value) &&
    isArray(value.roundTrip) &&
    value.roundTrip.every(isNumber) &&
    isArray(value.inference) &&
    value.inference.every(isNumber)
  );
};
