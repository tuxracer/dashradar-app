import { coverScale } from "@/lib/detection";
import type { Size } from "@/lib/detection";
import { ASSUMED_CAMERA_HFOV_DEG, MAX_INTEGRATION_DT_SECONDS } from "./consts";
import type { RotationRate, YawPitch } from "./types";

export * from "./consts";
export * from "./types";

/**
 * Map a device-frame rotation rate onto screen-aligned yaw/pitch rates. The
 * `devicemotion` axes are expressed in the device's portrait frame, so the
 * mapping swaps and flips as `screen.orientation.angle` changes. Signs follow
 * the convention that a rightward pan increases yaw; verify on-device with the
 * debug readout, since the physical axis signs are easy to get backwards.
 */
export const mapRotationRateToScreen = (
  rate: RotationRate,
  orientationAngle: number,
): { yawRate: number; pitchRate: number } => {
  switch (orientationAngle) {
    case 90:
      return { yawRate: -rate.beta, pitchRate: rate.gamma };
    case 180:
      return { yawRate: -rate.gamma, pitchRate: -rate.beta };
    case 270:
      return { yawRate: rate.beta, pitchRate: -rate.gamma };
    default:
      return { yawRate: rate.gamma, pitchRate: rate.beta };
  }
};

/** Radians per degree, for converting deg/s rates into radian orientation. */
const DEG_TO_RAD = Math.PI / 180;

/** Integrate a screen-aligned deg/s rate into cumulative radians over dt seconds. */
export const integrateYawPitch = (
  prev: YawPitch,
  screenRate: { yawRate: number; pitchRate: number },
  dtSeconds: number,
): YawPitch => {
  const dt = Math.min(Math.max(dtSeconds, 0), MAX_INTEGRATION_DT_SECONDS);
  return {
    yaw: prev.yaw + screenRate.yawRate * DEG_TO_RAD * dt,
    pitch: prev.pitch + screenRate.pitchRate * DEG_TO_RAD * dt,
  };
};

/**
 * Convert a yaw/pitch delta (radians) to a screen-space pixel offset for the
 * HUD overlay. Uses the same cover-scaled displayed video dimensions as
 * mapBoxToViewport so compensation lives in the box coordinate model. The box
 * moves opposite the camera rotation, so the offset negates yaw.
 */
export const orientationDeltaToPixels = (
  delta: YawPitch,
  video: Size,
  viewport: Size,
  hFovDeg: number = ASSUMED_CAMERA_HFOV_DEG,
): { dx: number; dy: number } => {
  const scale = coverScale(video, viewport);
  const displayedWidth = video.width * scale;
  const displayedHeight = video.height * scale;
  const hFovRad = hFovDeg * DEG_TO_RAD;
  const vFovRad =
    2 * Math.atan(Math.tan(hFovRad / 2) * (displayedHeight / displayedWidth));
  return {
    dx: -delta.yaw * (displayedWidth / hFovRad) + 0, // + 0 normalizes -0 to 0 so a zero delta returns exactly { dx: 0, dy: 0 }
    dy: delta.pitch * (displayedHeight / vFovRad) + 0, // + 0 normalizes -0 to 0 so a zero delta returns exactly { dx: 0, dy: 0 }
  };
};
