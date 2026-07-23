/**
 * Back camera preferred. The detector feeds the model the largest centered
 * 512x512 square of each frame (`INPUT_SIZE`; a debug-only toggle can squish
 * the full frame instead), so 512 on each axis is all inference ever reads.
 * We request a 512-tall landscape stream rather than 720p+ to avoid capturing
 * pixels the model immediately throws away; at 512 tall the center crop comes
 * out at native resolution with no resampling.
 */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 512 },
    height: { ideal: 512 },
  },
};
