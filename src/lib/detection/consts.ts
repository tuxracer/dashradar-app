/**
 * Detections below this score are discarded. It comes from the shipping
 * checkpoint's own release notes, the score its precision and recall were
 * measured at, rounded to the nearest tenth: the developer confidence slider
 * moves in tenths, so a floor off that grid cannot be dialed back to by hand
 * and turning Developer options on would quietly move the threshold. The
 * rounding is small next to the plateau a recommended threshold sits on. A
 * false alert costs more than a missed one here: the driver who is shown a
 * patrol car that is not there stops trusting the meter.
 *
 * This value does not survive a checkpoint change. Every release recalibrates
 * its own score distribution, so swapping DEFAULT_MODEL means reading the new
 * release's recommended threshold and moving this with it; carrying the old
 * number across is how a detector ends up quietly deaf or quietly noisy.
 * SIGNAL_FLOOR in src/lib/radarSignal is the same value and moves with it, or
 * the meter spends range on scores that can never arrive.
 */
export const CONFIDENCE_THRESHOLD = 0.6;

/**
 * Box and label color in the detection view, the same for every class. A
 * checkpoint names its classes but says nothing about how to draw them, and
 * inventing a color per class means a table here that a new checkpoint's labels
 * would immediately fall through. The label on the box already says which class
 * it is. A CSS color string applied as an inline style rather than a Tailwind
 * class, because Tailwind cannot build a class name from a runtime value; amber
 * matches the rest of the HUD.
 */
export const DETECTION_COLOR = "rgb(255, 179, 64)";
