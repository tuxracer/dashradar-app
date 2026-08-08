import { SCAN_MINUTE_BUCKETS } from "./consts";
import type { ScanClock } from "./types";

export * from "./consts";
export * from "./types";

/** Milliseconds in a minute, for the bucket ladder below. */
const MS_PER_MINUTE = 60_000;

/**
 * Milliseconds snapped down to the nearest bucket, so a reported number always
 * means "scanned at least this long".
 */
export const toBucketedMinutes = (ms: number): number => {
  const minutes = ms / MS_PER_MINUTE;
  return SCAN_MINUTE_BUCKETS.reduce(
    (snapped, bucket) => (bucket <= minutes ? bucket : snapped),
    SCAN_MINUTE_BUCKETS[0],
  );
};

/**
 * How long the pump actually spends scanning over a page's life, minus what has
 * already been reported. Driven by the pump's running window rather than wall
 * clock, since a hidden page or an open settings panel is not drive time.
 */
export const createScanClock = (now = () => performance.now()): ScanClock => {
  /** Scanning time from stretches that have already ended. */
  let completedMs = 0;
  /** When the current stretch began, or undefined while the pump is stopped. */
  let startedAt: number | undefined;
  /** Scanning time already covered by a `scan_session` event. */
  let reportedMs = 0;

  /** Scanning time so far, including the stretch in progress. */
  const elapsedMs = () =>
    completedMs + (startedAt === undefined ? 0 : now() - startedAt);

  return {
    /** Begin a scanning stretch. Idempotent: a second call keeps the first. */
    start: () => {
      startedAt ??= now();
    },

    /** End the current stretch, folding it into the total. */
    stop: () => {
      if (startedAt !== undefined) {
        completedMs += now() - startedAt;
        startedAt = undefined;
      }
    },

    /**
     * Unreported scanning time, claimed as reported in the same breath, which is
     * what keeps the sum of the reports equal to the total scanned. Below
     * `minimumMs` nothing is claimed, so short stretches accumulate rather than
     * being discarded one sliver at a time.
     */
    takeUnreportedMs: (minimumMs = 0) => {
      const total = elapsedMs();
      const unreported = total - reportedMs;
      if (unreported < minimumMs) {
        return 0;
      }
      reportedMs = total;
      return unreported;
    },
  };
};
