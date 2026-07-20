import type { HudModel } from "@/lib/detection";
import {
  DECAY_PER_SEC,
  SIGNAL_FLOOR,
  SIGNAL_HIGH_COLOR,
  SIGNAL_LOW_COLOR,
  SIGNAL_MID_COLOR,
} from "./consts";

export * from "./consts";

/** Clamp a number into the inclusive [0, 1] range. */
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Linear interpolation between a and b by t in [0, 1]. */
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Interpolate two [r, g, b] triples into a CSS `rgb(...)` string. */
const mixColor = (
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  t: number,
): string => {
  const r = Math.round(lerp(from[0], to[0], t));
  const g = Math.round(lerp(from[1], to[1], t));
  const b = Math.round(lerp(from[2], to[2], t));
  return `rgb(${r}, ${g}, ${b})`;
};

/**
 * Current police-signal strength for a HUD frame, in [0, 1]. Takes the highest
 * detection score across the HUD (nearest plus the others) and remaps the
 * [SIGNAL_FLOOR, 1] score band onto [0, 1] so the ladder uses its full range.
 * Returns 0 for no HUD, no detections, or a max score at or below the floor.
 */
export const hudSignal = (hud: HudModel | undefined): number => {
  if (!hud) {
    return 0;
  }
  const detections = hud.nearest ? [hud.nearest, ...hud.others] : hud.others;
  if (detections.length === 0) {
    return 0;
  }
  const max = Math.max(...detections.map((detection) => detection.score));
  if (max <= SIGNAL_FLOOR) {
    return 0;
  }
  return clamp01((max - SIGNAL_FLOOR) / (1 - SIGNAL_FLOOR));
};

/**
 * One peak-hold + decay step. The value snaps up to `raw` instantly and eases
 * back down at DECAY_PER_SEC per second when `raw` is lower. Clamped to [0, 1].
 */
export const decayPeak = (prev: number, raw: number, dtSec: number): number =>
  clamp01(Math.max(raw, prev - DECAY_PER_SEC * dtSec));

/** Number of ladder segments lit for a signal level in [0, 1]. */
export const litSegments = (level: number, count: number): number =>
  Math.round(clamp01(level) * count);

/**
 * Single color for the whole lit ladder at a signal level in [0, 1],
 * interpolated green -> amber -> red.
 */
export const signalColor = (level: number): string => {
  const clamped = clamp01(level);
  return clamped < 0.5
    ? mixColor(SIGNAL_LOW_COLOR, SIGNAL_MID_COLOR, clamped / 0.5)
    : mixColor(SIGNAL_MID_COLOR, SIGNAL_HIGH_COLOR, (clamped - 0.5) / 0.5);
};
