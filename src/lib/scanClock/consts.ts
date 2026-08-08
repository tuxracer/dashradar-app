/**
 * Minute marks a reported stretch is snapped down to, so the analytics facet
 * stays a handful of values rather than one per session. Fine near the bottom,
 * where a session that died at one minute against one that ran ten is the whole
 * question, and coarse at the top, where anything past two hours is a long drive.
 */
export const SCAN_MINUTE_BUCKETS = [
  0, 1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240,
];

/**
 * Scanning time a stretch must reach to be worth an event. Below this it scanned
 * at most one frame, and reporting it would turn the sliver between a
 * hidden-page report and the pump stopping into a second, empty session.
 */
export const SCAN_REPORT_MIN_MS = 1_000;
