import type { ContactDirection } from "@/lib/radarSignal";

/**
 * The meter thresholds live with the signal math (src/lib/radarSignal);
 * re-exported so this module keeps being the one import for meter UI.
 */
export { ALERT_THRESHOLD, CONTACT_THRESHOLD } from "@/lib/radarSignal";

/**
 * Total angular sweep of the segment arc in degrees, opening at the bottom
 * like a tachometer. Tuned visually against a landscape phone frame.
 */
export const ARC_SWEEP_DEG = 240;

/**
 * Decimal places the readout uses for a raw model score (the raw-confidence
 * developer option), e.g. "0.87". Matches the resolution of the whole-number
 * percentage it replaces.
 */
export const RAW_CONFIDENCE_DECIMALS = 2;

/**
 * Milliseconds per full revolution of the sweep, kept at the pace of the
 * continuous 5 s spin the per-scan stepping replaced. A full turn per scan
 * was tried first and rejected: at the 1 s scan floor it span the dial more
 * than five times faster than this, which read as frantic and pulled the
 * eye. The wedge only ever moves at this angular velocity; scans just
 * decide when it moves.
 */
export const SWEEP_REVOLUTION_MS = 5_000;

/**
 * Duration of the arc step one completed scan advances the sweep by. Equal
 * to the engine's 1 s pacing floor so that at floor pacing each step ends
 * about when the next result lands and the steps chain into a seamless
 * rotation; when the pacing backs off, the sweep parks between steps and the
 * dial shows the true scan cadence.
 */
export const SWEEP_STEP_MS = 1_000;

/** Degrees one scan advances the sweep: the revolution pace times the step. */
export const SWEEP_STEP_DEG = 360 * (SWEEP_STEP_MS / SWEEP_REVOLUTION_MS);

/** Display strings for the contact card's direction row. */
export const DIRECTION_DISPLAY: Readonly<Record<ContactDirection, string>> = {
  left: "◀ LEFT",
  ahead: "▲ AHEAD",
  right: "RIGHT ▶",
};
