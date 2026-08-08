/**
 * How often the panel re-reads the debug snapshot. Paced in wall time rather than
 * per frame: the readout is for eyeballing numbers, and scans land about a second
 * apart, so a per-frame poll would be wake-ups spent on nothing.
 */
export const READOUT_INTERVAL_MS = 120;
