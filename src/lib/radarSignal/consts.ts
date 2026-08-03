import { CONFIDENCE_THRESHOLD } from "@/lib/detection";

/** Number of segments in the radar-detector ladder. Tune visually on-device. */
export const SEGMENT_COUNT = 14;

/**
 * Peak-hold falloff rate, in signal-fraction per second. The held peak eases
 * back down at this rate once the raw signal drops. Detection results arrive
 * at most once per second (MIN_FRAME_INTERVAL_MS), and slow devices' rest
 * ratio can stretch the gap to two seconds or more, so this must be small
 * enough that the peak meaningfully bridges consecutive results: at 0.15 a
 * full-scale peak takes over 6 seconds to drain, so the meter falls about 30
 * points across a two-second gap, where the old 0.6 let it fall 60 points in a
 * single second and whipsaw on score jitter. Attack stays instant (see
 * decayPeak), matching real radar detectors: latch on fast, fall off slow.
 * Tune on-device.
 */
export const DECAY_PER_SEC = 0.15;

/**
 * Scores at or below this fraction map to zero signal. It is the detection
 * confidence threshold rather than a copy of its number: anything the
 * confidence filter keeps is already above it, so the ladder maps its full
 * range onto the meaningful [floor, 1] score band. Held to that value by
 * import because the two failure modes are silent. A floor left below the
 * threshold wastes the bottom of the ladder on scores that never arrive, and a
 * floor left above it reads real detections as no signal at all.
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
