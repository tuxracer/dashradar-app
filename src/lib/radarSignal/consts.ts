/** Number of segments in the radar-detector ladder. Tune visually on-device. */
export const SEGMENT_COUNT = 14;

/**
 * Peak-hold falloff rate, in signal-fraction per second. The held peak eases
 * back down at this rate once the raw signal drops. Tune on-device.
 */
export const DECAY_PER_SEC = 0.6;

/**
 * Scores at or below this fraction map to zero signal. Matches the detection
 * confidence threshold: anything the road filter keeps is already above it, so
 * the ladder maps its full range onto the meaningful [floor, 1] score band.
 */
export const SIGNAL_FLOOR = 0.7;

/** Ladder color at low signal (green), as an [r, g, b] triple. */
export const SIGNAL_LOW_COLOR: readonly [number, number, number] = [
  74, 222, 64,
];

/** Ladder color at mid signal (amber, the app accent), as an [r, g, b] triple. */
export const SIGNAL_MID_COLOR: readonly [number, number, number] = [
  255, 179, 64,
];

/** Ladder color at full signal (red), as an [r, g, b] triple. */
export const SIGNAL_HIGH_COLOR: readonly [number, number, number] = [
  255, 90, 60,
];
