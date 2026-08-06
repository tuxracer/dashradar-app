/**
 * How often the panel re-reads the debug snapshot, in milliseconds. The
 * readout is for eyeballing numbers on a device, not for smoothness, so it is
 * paced in wall time rather than per frame: at the pacing floor a scan lands
 * about once a second, and ~8 Hz is quick enough to catch one landing while
 * costing a fraction of the wake-ups a per-frame poll would.
 */
export const READOUT_INTERVAL_MS = 120;
