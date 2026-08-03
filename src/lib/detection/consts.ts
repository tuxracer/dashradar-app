/** Detections below this score are discarded. */
export const CONFIDENCE_THRESHOLD = 0.5;

/**
 * The nearest object gets the amber NEAR treatment once its box covers this
 * fraction of the frame. Tune on-device.
 */
export const NEAR_AREA_FRACTION = 0.06;
