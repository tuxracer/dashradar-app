/**
 * Requested camera frame rate. Detection consumes about one frame a second, but
 * the sensor and ISP run at the granted rate all session, so halving the default
 * halves that draw. Not lower on purpose: auto-exposure stretches shutter time
 * toward the frame period, and long shutters motion-blur the night frames the
 * model needs sharp. Verify a change on a dash-mounted device, day and night.
 */
export const CAMERA_FRAME_RATE = 15;

/**
 * Back camera preferred, at roughly twice the model's input edge rather than the
 * edge itself, so the 2x zoom has real pixels to work with: at 2x the crop is
 * half the frame's short edge and lands at 512 native with no upsampling.
 * Inference runs on a fixed input either way, so the extra cost is capture power,
 * which CAMERA_FRAME_RATE bounds.
 */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1024 },
    height: { ideal: 1024 },
    frameRate: { ideal: CAMERA_FRAME_RATE },
  },
};
