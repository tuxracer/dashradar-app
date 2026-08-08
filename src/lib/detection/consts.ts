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

/**
 * Own-hood geometry, all fractions of the scanned region (never the full
 * frame: on a landscape frame the model sees only the centered square, so a
 * hood spanning everything it can see is nowhere near full-frame width).
 * A box is the camera car's own hood when it clears all three: at least this
 * share of the region's width ...
 */
export const OWN_HOOD_MIN_WIDTH = 0.8;
/** ... no taller than this share of the region's height ... */
export const OWN_HOOD_MAX_HEIGHT = 0.4;
/**
 * ... and pinned to the region's bottom edge, within this slack for box
 * jitter. The hood always runs off the bottom of the frame, which is what
 * separates it from a wide vehicle ahead standing on visible road.
 */
export const OWN_HOOD_MAX_BOTTOM_GAP = 0.05;
