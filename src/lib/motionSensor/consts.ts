/**
 * Assumed horizontal camera field of view in degrees. The Web APIs do not
 * expose a real camera FOV, so this is the single tuning knob that maps a
 * pan angle to screen pixels. A wrong value only makes the compensated box
 * slightly under- or over-shoot the pan; tune it against the debug readout
 * on-device. Vertical FOV is derived from the displayed aspect ratio.
 */
export const ASSUMED_CAMERA_HFOV_DEG = 65;

/** Largest per-sample integration step, clamped to reject long gaps (tab hidden). */
export const MAX_INTEGRATION_DT_SECONDS = 0.1;

/** localStorage key recording that iOS motion permission was granted before. */
export const MOTION_GRANTED_KEY = "dashradar:motionGranted";
