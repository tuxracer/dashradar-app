/**
 * A frame reduced to one mean luma per tile, row-major. Small enough to hold the
 * last scanned frame indefinitely, which is what lets the comparison run against
 * the frame the model last looked at rather than the previous one.
 */
export type SceneSignature = Float32Array;

/** What comparing two signatures decided, and the number behind the decision. */
export type SceneComparison = {
  /** Whether the scene moved enough to be worth running inference on. */
  changed: boolean;
  /**
   * Largest per-tile luma shift after the frame-wide shift was removed, on the
   * same 0-255 scale as the threshold. Reported whatever the verdict, so the
   * threshold can be tuned against measured values on a device.
   */
  delta: number;
};
