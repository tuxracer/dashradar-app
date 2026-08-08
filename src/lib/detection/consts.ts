/**
 * Detections below this score are discarded: the operating point the shipping
 * checkpoint's release notes measured precision and recall at, rounded to the
 * developer slider's grid so turning Developer options on cannot move it.
 *
 * It does not survive a checkpoint change. Every release recalibrates its own
 * score distribution, so a swap means moving this to the new recommended
 * threshold, and SIGNAL_FLOOR with it.
 */
export const CONFIDENCE_THRESHOLD = 0.6;
