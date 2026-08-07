import { CONFIDENCE_THRESHOLD } from "@/lib/detection";

/** Number of segments in the radar-detector ladder. Tune visually on-device. */
export const SEGMENT_COUNT = 14;

/**
 * Peak-hold falloff, in signal-fraction per second. Results land a second or more
 * apart, so this has to be slow enough for the peak to bridge consecutive ones:
 * at 0.15 the meter falls about 30 points across a two-second gap, where a rate
 * four times faster whipsawed on score jitter. Attack stays instant, matching a
 * real radar detector: latch on fast, fall off slow. Tune on-device.
 */
export const DECAY_PER_SEC = 0.15;

/**
 * Scores at or below this map to zero signal, so the ladder spends its full range
 * on the band that can actually arrive. Imported rather than copied because both
 * failure modes are silent: below the threshold wastes the bottom of the ladder,
 * above it reads real detections as no signal at all.
 */
export const SIGNAL_FLOOR = CONFIDENCE_THRESHOLD;

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

/** Box center-x at or below this fraction reads as a left contact. */
export const DIRECTION_LEFT_MAX = 1 / 3;

/** Box center-x at or above this fraction reads as a right contact. */
export const DIRECTION_RIGHT_MIN = 2 / 3;

/**
 * Signal level at or above which the pulsing alert ring lights up, marking a
 * strong signal.
 */
export const ALERT_THRESHOLD = 0.8;

/**
 * Where the meter registers a contact and the status word leaves SCANNING. Just
 * above zero, so the idle meter stays quiet and any real signal registers at once.
 */
export const CONTACT_THRESHOLD = 0.01;
