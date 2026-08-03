/**
 * Detections below this score are discarded. Set near the shipping
 * checkpoint's own operating point, the score its release reports precision
 * and recall at, so what reaches the HUD sits in the band the model was
 * actually measured in. A false alert costs more than a missed one here: the
 * driver who is shown a patrol car that is not there stops trusting the meter.
 * SIGNAL_FLOOR in src/lib/radarSignal is the same value and moves with it, or
 * the meter spends range on scores that can never arrive.
 */
export const CONFIDENCE_THRESHOLD = 0.7;

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
