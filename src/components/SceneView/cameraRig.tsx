import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { Euler, Quaternion, Vector3 } from "three";
import { clamp } from "remeda";
import {
  CAMERA_TARGET,
  RIG_BASELINE_ADAPT,
  RIG_DEADBAND_RAD,
  RIG_PITCH_CLAMP_RAD,
  RIG_SMOOTHING,
  RIG_YAW_CLAMP_RAD,
} from "./consts";

/** World up axis, for unwinding the screen-orientation angle. */
const Z_AXIS = new Vector3(0, 0, 1);

/** Fixed -90 degree rotation about x: device frame to camera frame. */
const CAMERA_FRAME = new Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));

/** Degrees to radians. */
const deg2rad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * World orientation of the device for one deviceorientation reading, the
 * standard alpha/beta/gamma to quaternion formula with the screen-orientation
 * angle unwound, so a reading means the same physical attitude in landscape
 * and portrait.
 */
export const orientationQuaternion = (
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
  screenAngleDeg: number,
): Quaternion => {
  const quaternion = new Quaternion().setFromEuler(
    new Euler(deg2rad(betaDeg), deg2rad(alphaDeg), -deg2rad(gammaDeg), "YXZ"),
  );
  quaternion.multiply(CAMERA_FRAME);
  quaternion.multiply(
    new Quaternion().setFromAxisAngle(Z_AXIS, -deg2rad(screenAngleDeg)),
  );
  return quaternion;
};

/**
 * Yaw and pitch of one orientation relative to another, in radians: how far
 * the device has turned left/right and tilted up/down from the neutral
 * attitude. Roll is deliberately dropped; a rolling horizon in a driving
 * instrument reads as the world tipping over.
 */
export const orientationOffsets = (
  neutral: Quaternion,
  current: Quaternion,
): { yawRad: number; pitchRad: number } => {
  const delta = neutral.clone().invert().multiply(current);
  const euler = new Euler().setFromQuaternion(delta, "YXZ");
  return { yawRad: euler.y, pitchRad: euler.x };
};

/**
 * Pans the chase camera with the phone's physical orientation: turn or tilt
 * the device and the scene looks the same way, eased and clamped, always
 * drifting back to center as the neutral attitude adapts (RIG_BASELINE_ADAPT),
 * so a skewed dash mount or a long highway curve never parks the view off
 * axis. Renders only through invalidate() and only when the smoothed offset
 * moves more than RIG_DEADBAND_RAD, so a vibrating mount costs no frames; that
 * dead band is load-bearing for the thermal budget, not a tuning nicety.
 * Where deviceorientation never fires (desktop, or iOS before its permission
 * grant) the listener simply stays silent and the camera holds its base
 * framing.
 */
export const CameraRig = ({ enabled }: { enabled: boolean }) => {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const target = new Vector3(
      CAMERA_TARGET[0],
      CAMERA_TARGET[1],
      CAMERA_TARGET[2],
    );
    const neutral = new Quaternion();
    let hasNeutral = false;
    let smoothedYaw = 0;
    let smoothedPitch = 0;
    let appliedYaw = 0;
    let appliedPitch = 0;

    const handleOrientation = (event: DeviceOrientationEvent) => {
      if (event.alpha === null || event.beta === null || event.gamma === null) {
        return;
      }
      const current = orientationQuaternion(
        event.alpha,
        event.beta,
        event.gamma,
        window.screen.orientation?.angle ?? 0,
      );
      if (!hasNeutral) {
        neutral.copy(current);
        hasNeutral = true;
        return;
      }
      neutral.slerp(current, RIG_BASELINE_ADAPT);
      const { yawRad, pitchRad } = orientationOffsets(neutral, current);
      const yaw = clamp(yawRad, {
        min: -RIG_YAW_CLAMP_RAD,
        max: RIG_YAW_CLAMP_RAD,
      });
      const pitch = clamp(pitchRad, {
        min: -RIG_PITCH_CLAMP_RAD,
        max: RIG_PITCH_CLAMP_RAD,
      });
      smoothedYaw += (yaw - smoothedYaw) * RIG_SMOOTHING;
      smoothedPitch += (pitch - smoothedPitch) * RIG_SMOOTHING;
      if (
        Math.abs(smoothedYaw - appliedYaw) < RIG_DEADBAND_RAD &&
        Math.abs(smoothedPitch - appliedPitch) < RIG_DEADBAND_RAD
      ) {
        return;
      }
      appliedYaw = smoothedYaw;
      appliedPitch = smoothedPitch;
      camera.lookAt(target);
      camera.rotateY(appliedYaw);
      camera.rotateX(appliedPitch);
      invalidate();
    };
    window.addEventListener("deviceorientation", handleOrientation);
    return () => {
      window.removeEventListener("deviceorientation", handleOrientation);
      camera.lookAt(target);
      invalidate();
    };
  }, [enabled, camera, invalidate]);

  return null;
};
