/**
 * Back camera preferred. The detector feeds the model a centered square of
 * each frame, resized to 512x512 (`INPUT_SIZE`), so the model never reads more
 * than 512 on a side.
 *
 * We request roughly 1024 rather than 512 so the 2x zoom has real
 * pixels to work with: at 2x the centered crop is half the frame's short edge,
 * which lands at 512 native with no upsampling. At 1x the full square
 * downsamples cleanly to 512. Capture is not the expensive part of a scan
 * (inference runs on a fixed 512x512 input either way, once every two seconds
 * under the pacing floor), so the extra cost is the camera's own capture power
 * plus one larger canvas draw per scan.
 */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1024 },
    height: { ideal: 1024 },
  },
};
