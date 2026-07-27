/**
 * Requested camera frame rate. Detection consumes about one frame every two
 * seconds (the pacing floor), but the sensor and ISP run at the granted rate
 * the whole session, and that pipeline is a steady power draw on a phone that
 * defaults to 30 fps. Requesting 15 roughly halves it. Not lower on purpose:
 * auto-exposure can stretch shutter time toward the frame period, and the long
 * shutters a very low rate permits motion-blur night frames of moving
 * vehicles, exactly the frames the model needs sharp. `ideal` keeps the
 * request best-effort, so a camera without a 15 fps mode still opens at
 * whatever it supports. Verify frame-rate changes on a real dash-mounted
 * device, day and night, before retuning.
 */
export const CAMERA_FRAME_RATE = 15;

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
 * plus one larger canvas draw per scan. The capture-power side is bounded by
 * CAMERA_FRAME_RATE above.
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
