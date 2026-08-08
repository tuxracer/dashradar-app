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
 * Raw labels folded into one surfaced class, keyed lowercase. The model
 * flickers between "car" and "truck" on a single vehicle, and a label change
 * is an identity change to the class-gated tracker, so every flicker minted a
 * fresh id for a vehicle that never moved. Folding at enrichment means nothing
 * downstream ever sees the raw pair: the id survives the flicker, and all
 * class-based logic reads the normalized name.
 */
export const NORMALIZED_CLASSES: Readonly<Record<string, string>> = {
  car: "vehicle",
  truck: "vehicle",
};

/**
 * Minimum IoU at which two same-class boxes in one frame count as one object.
 * Higher than the tracker's cross-frame match floor on purpose: two real
 * vehicles side by side can overlap moderately, while a double-fired query
 * pair sits almost on top of itself.
 */
export const DUPLICATE_IOU_THRESHOLD = 0.5;

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
