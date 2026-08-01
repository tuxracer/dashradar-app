/**
 * Minute marks a reported scanning stretch is snapped down to, so the analytics
 * facet stays a handful of readable values instead of one per session. Fine
 * near the bottom, where the difference between a session that died at one
 * minute and one that ran ten is the whole question, and coarse at the top,
 * where anything past two hours is simply "a long drive". A stretch under a
 * minute reads as 0.
 */
export const SCAN_MINUTE_BUCKETS = [
  0, 1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240,
];

/**
 * Scanning time a stretch must reach before it is worth an event. Below this a
 * stretch scanned at most one frame, and reporting it would turn the sliver of
 * clock left over between a hidden-page report and the pump actually stopping
 * into a second, empty session in the count.
 */
export const SCAN_REPORT_MIN_MS = 1_000;
