import { SCAN_MINUTE_BUCKETS } from "./consts";
import type { ScanClock } from "./types";

export * from "./consts";
export * from "./types";

/** Milliseconds in a minute, for the bucket ladder below. */
const MS_PER_MINUTE = 60_000;

/**
 * Milliseconds snapped down to the nearest {@link SCAN_MINUTE_BUCKETS} mark, so
 * a reported number always means "scanned at least this long": 4 minutes reads
 * as 2, 4 hours as 240. Snapping down rather than to the nearest keeps the
 * reading one-directional, which matters for a number used to ask whether
 * sessions survive a drive.
 */
export const toBucketedMinutes = (ms: number): number => {
  const minutes = ms / MS_PER_MINUTE;
  return SCAN_MINUTE_BUCKETS.reduce(
    (snapped, bucket) => (bucket <= minutes ? bucket : snapped),
    SCAN_MINUTE_BUCKETS[0],
  );
};

/**
 * Measures how long the frame pump actually spends scanning over a page's life,
 * and hands out the part of it that has not been reported to analytics yet.
 *
 * Scanning time is not page time: the pump stops while the settings panel is
 * open, while the page is hidden, and between a stall and its recovery, and
 * none of that is drive time the detector was watching the road. The clock is
 * therefore driven by the pump's own running window rather than by wall clock.
 *
 * `now` is a parameter only so tests can control the passage of time.
 */
export const createScanClock = (now = () => performance.now()): ScanClock => {
  /** Scanning time from stretches that have already ended. */
  let completedMs = 0;
  /** When the current stretch began, or undefined while the pump is stopped. */
  let startedAt: number | undefined;
  /** Scanning time already covered by a `scan_session` event. */
  let reportedMs = 0;

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

    /** Total scanning time this page load, including the stretch in progress. */
    elapsedMs,

    /**
     * Scanning time not yet reported, claiming it as reported in the same
     * breath, or 0 when there is less than `minimumMs` of it. Claiming and
     * reading together is what keeps the sum of the reports equal to the total
     * scanned: an interrupted drive reports each of its stretches once, and
     * nothing is counted twice or lost between them. Below the minimum nothing
     * is claimed, so a run of very short stretches accumulates until it is
     * worth an event rather than being discarded one sliver at a time.
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
