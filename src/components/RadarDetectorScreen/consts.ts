import { MIN_FRAME_INTERVAL_MS } from "@/lib/detectionEngine";
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
 * How long after the last completed scan the sweep keeps spinning before it
 * pauses and hides, waiting for the next one.
 *
 * The wedge's job is to say the detector is scanning, not to reproduce the
 * cadence: it turns at a fixed pace (see the radar-sweep animation in
 * globals.css) whenever scans are arriving. Half again the pacing floor is
 * enough slack that a device scanning as fast as it is allowed to never
 * pauses, while a device that has backed off, which is where a spin nobody
 * asked for costs something, goes dark for the whole second or more it spends
 * waiting.
 */
export const SWEEP_IDLE_HIDE_MS = MIN_FRAME_INTERVAL_MS * 1.5;

/** Display strings for the contact card's direction row. */
export const DIRECTION_DISPLAY: Readonly<Record<ContactDirection, string>> = {
  left: "◀ LEFT",
  ahead: "▲ AHEAD",
  right: "RIGHT ▶",
};
