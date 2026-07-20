/**
 * Total angular sweep of the segment arc in degrees, opening at the bottom
 * like a tachometer. Tuned visually against a landscape phone frame.
 */
export const ARC_SWEEP_DEG = 240;

/**
 * Signal level at or above which the meter enters its ALERT state: the status
 * word flips to ALERT and the red ring around the readout pulses.
 */
export const ALERT_THRESHOLD = 0.85;

/**
 * Signal level at or above which the meter reads CONTACT instead of SCANNING
 * and the readout takes the signal color. Just above zero so the idle meter
 * stays quiet while any real signal registers immediately.
 */
export const CONTACT_THRESHOLD = 0.01;
