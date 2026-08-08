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
 * Box color in the detection view, one for every class: a checkpoint says nothing
 * about how to draw its classes, and a color table here is one a new checkpoint
 * falls straight through. A CSS string, since Tailwind cannot build a class name
 * from a runtime value.
 */
export const DETECTION_COLOR = "rgb(255, 179, 64)";
