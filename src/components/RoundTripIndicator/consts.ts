/**
 * How often the pill re-reads the debug snapshot, in milliseconds. A scan
 * lands at most once every MIN_FRAME_INTERVAL_MS under the pacing floor, so a
 * ~4 Hz readout shows a new round trip promptly without polling every frame.
 */
export const READOUT_INTERVAL_MS = 250;
