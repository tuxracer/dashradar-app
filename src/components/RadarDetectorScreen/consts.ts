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

/** Display strings for the contact card's direction row. */
export const DIRECTION_DISPLAY: Readonly<Record<ContactDirection, string>> = {
  left: "◀ LEFT",
  ahead: "▲ AHEAD",
  right: "RIGHT ▶",
};
