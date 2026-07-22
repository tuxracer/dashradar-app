import type { ContactDirection } from "@/lib/radarSignal";

/**
 * Total angular sweep of the segment arc in degrees, opening at the bottom
 * like a tachometer. Tuned visually against a landscape phone frame.
 */
export const ARC_SWEEP_DEG = 240;

/**
 * Signal level at or above which the pulsing red ring around the readout
 * lights up, marking a strong signal.
 */
export const ALERT_THRESHOLD = 0.8;

/**
 * Signal level at or above which the meter registers a contact: the readout
 * and status word take the signal color and the status word flips from
 * SCANNING to ALERT. Just above zero so the idle meter stays quiet while any
 * real signal registers immediately.
 */
export const CONTACT_THRESHOLD = 0.01;

/** Display strings for the contact card's direction row. */
export const DIRECTION_DISPLAY: Readonly<Record<ContactDirection, string>> = {
  left: "◀ LEFT",
  ahead: "▲ AHEAD",
  right: "RIGHT ▶",
};
