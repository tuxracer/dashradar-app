/**
 * How often the pill re-reads the debug snapshot, in milliseconds. A scan
 * lands at most once every MIN_FRAME_INTERVAL_MS under the pacing floor, so a
 * ~4 Hz readout shows a new round trip promptly while taking a small fraction
 * of the wake-ups a per-frame poll would.
 */
export const READOUT_INTERVAL_MS = 250;
