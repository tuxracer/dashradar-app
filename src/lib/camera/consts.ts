/**
 * Back camera preferred. The detector squashes each frame onto a 512x512 square
 * (`INPUT_SIZE`), so 512 on each axis is all inference ever reads. We request a
 * 512-tall landscape stream rather than 720p+ to avoid capturing pixels the
 * model immediately throws away.
 */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 512 },
    height: { ideal: 512 },
  },
};
