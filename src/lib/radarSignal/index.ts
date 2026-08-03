import type { HudModel } from "@/lib/detection";
import type { NormalizedBox } from "@/types";
import type { ContactDirection } from "./types";
import {
  ALERT_THRESHOLD,
  CONTACT_THRESHOLD,
  DECAY_PER_SEC,
  DIRECTION_LEFT_MAX,
  DIRECTION_RIGHT_MIN,
  SIGNAL_FLOOR,
  SIGNAL_HIGH_COLOR,
  SIGNAL_LOW_COLOR,
  SIGNAL_MID_COLOR,
} from "./consts";

export * from "./types";
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
 * Remap a raw detection score onto the meter's [0, 1] signal band. Scores at
 * or below SIGNAL_FLOOR read as zero; the [floor, 1] band stretches over the
 * full range. Shared by the dial (via hudSignal) and the contact card so the
 * two readouts always agree on what a percent means.
 */
export const signalFromScore = (score: number): number => {
  if (score <= SIGNAL_FLOOR) {
    return 0;
  }
  return clamp01((score - SIGNAL_FLOOR) / (1 - SIGNAL_FLOOR));
};

/** Which third of the frame a contact's box center falls in. */
export const contactDirection = (box: NormalizedBox): ContactDirection => {
  const centerX = (box.xmin + box.xmax) / 2;
  if (centerX <= DIRECTION_LEFT_MAX) {
    return "left";
  }
  if (centerX >= DIRECTION_RIGHT_MIN) {
    return "right";
  }
  return "ahead";
};

/**
 * Highest detection score in a HUD frame, in [0, 1], before the SIGNAL_FLOOR
 * remap the meter applies. Returns 0 for no HUD or no detections. This is what
 * the raw-confidence developer option puts in the dial readout in place of the
 * remapped percentage.
 */
export const hudScore = (hud: HudModel | undefined): number =>
  hud?.top?.score ?? 0;

/**
 * Current signal strength for a HUD frame, in [0, 1]. Takes the highest
 * detection score in the frame and remaps the [SIGNAL_FLOOR, 1] score band
 * onto [0, 1] so the ladder uses its full range. Returns 0 for no HUD, no
 * detections, or a max score at or below the floor.
 */
export const hudSignal = (hud: HudModel | undefined): number =>
  signalFromScore(hudScore(hud));

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

/** The meter's cross-frame state: the peak-held level and the held label. */
export type MeterState = {
  /** Peak-held meter level in [0, 1], decaying toward the live signal. */
  level: number;
  /**
   * The class name the status word is naming. Held across the dial's decay
   * tail: the live label clears the instant the raw signal does, but the
   * peak-held level keeps reading a number for about a second after, and the
   * word must not snap back while the dial still shows one. Released once the
   * meter fully decays to zero.
   */
  heldLabel: string | undefined;
};

/** The meter's state before any signal has registered. */
export const initialMeterState = (): MeterState => ({
  level: 0,
  heldLabel: undefined,
});

/** What one meter step says the display should show. */
export type MeterDisplay = {
  /** Peak-held level driving the ladder, readout, and glow. */
  level: number;
  /** Whether the meter registers a contact (readout and word take color). */
  hasSignal: boolean;
  /** Whether the pulsing alert ring is lit. */
  alert: boolean;
  /** Whether the contact card is shown (a contact exists and the meter is live). */
  contactShown: boolean;
  /** The class name to display, surviving the decay tail. */
  heldLabel: string | undefined;
};

/**
 * One step of the meter's display state machine: peak-hold decay, the
 * held-label rule, and the threshold gates, pure so the rendering loop that
 * calls it per animation frame is nothing but "step, write, park when
 * quiescent". The quiescence test is the caller's (raw signal zero and level
 * zero), since only the caller knows the raw signal.
 */
export const stepMeter = (
  state: MeterState,
  inputs: {
    /** Live signal in [0, 1] (hudSignal). */
    signal: number;
    /** Class label of the live detection, if any. */
    detectedLabel: string | undefined;
    /** Whether a contact image exists to show. */
    contactPresent: boolean;
  },
  dtSec: number,
): { state: MeterState; display: MeterDisplay } => {
  const level = decayPeak(state.level, inputs.signal, dtSec);
  const heldLabel =
    inputs.detectedLabel !== undefined
      ? inputs.detectedLabel
      : level === 0
        ? undefined
        : state.heldLabel;
  return {
    state: { level, heldLabel },
    display: {
      level,
      hasSignal: level >= CONTACT_THRESHOLD,
      alert: level >= ALERT_THRESHOLD,
      contactShown: inputs.contactPresent && level > 0,
      heldLabel,
    },
  };
};
