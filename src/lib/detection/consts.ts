/**
 * Detections below this score are discarded. It is the operating point the
 * shipping checkpoint's release notes measured precision and recall at, rounded
 * to the nearest tenth so it sits on the developer slider's grid and turning
 * Developer options on cannot quietly move it.
 *
 * It does not survive a checkpoint change: every release recalibrates its own
 * score distribution, so a swap means reading the new recommended threshold and
 * moving this with it, or the detector ends up quietly deaf or quietly noisy.
 * SIGNAL_FLOOR moves with it, or the meter spends range on impossible scores.
 */
export const CONFIDENCE_THRESHOLD = 0.6;

/**
 * Box and label color in the detection view, one for every class: a checkpoint
 * names its classes but says nothing about how to draw them, and a color table
 * here is one a new checkpoint's labels fall straight through. The label on the
 * box already says which class it is. A CSS string rather than a Tailwind class,
 * since Tailwind cannot build a class name from a runtime value.
 */
export const DETECTION_COLOR = "rgb(255, 179, 64)";
