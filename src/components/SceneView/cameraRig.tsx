import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { Euler, Object3D, Quaternion, Vector3 } from "three";
import { clamp } from "remeda";
import {
  CAMERA_TARGET,
  RIG_DEADBAND_RAD,
  RIG_PITCH_CLAMP_RAD,
  RIG_SETTLE_MS,
  RIG_SMOOTHING_MS,
  RIG_YAW_CLAMP_RAD,
} from "./consts";

/** World up axis, which the rig yaws about. */
const Y_AXIS = new Vector3(0, 1, 0);

/** World forward axis, for unwinding the screen-orientation angle. */
const Z_AXIS = new Vector3(0, 0, 1);

/** Fixed -90 degree rotation about x: device frame to camera frame. */
const CAMERA_FRAME = new Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));

/** Degrees to radians. */
const deg2rad = (deg: number): number => (deg * Math.PI) / 180;

/** Fraction of the way an exponential ease moves in `dtMs` with time constant `tauMs`. */
const easeFraction = (dtMs: number, tauMs: number): number =>
  1 - Math.exp(-dtMs / tauMs);

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
 * Points the camera at the target, then yaws it about world up and pitches it
 * about its own lateral axis. The yaw must be about world up: the camera looks
 * down at the road, so its own y axis leans back, and yawing about that tips
 * the horizon by a few degrees whenever the view is off center.
 */
export const aimCamera = (
  camera: Object3D,
  target: Vector3,
  yawRad: number,
  pitchRad: number,
): void => {
  camera.lookAt(target);
  camera.rotateOnWorldAxis(Y_AXIS, yawRad);
  camera.rotateX(pitchRad);
};

/** The rig's smoothing, with readings fed in and camera offsets handed out. */
export type OrientationRig = {
  /** Takes the newest reading; the next step compares against it. */
  read: (current: Quaternion) => void;
  /**
   * Advances the easing to `nowMs`, applying the camera offset when it has
   * moved enough to show. False once the camera is parked at center.
   */
  step: (nowMs: number) => boolean;
};

/**
 * Eases a neutral attitude toward the newest reading and the camera toward
 * the clamped difference, on wall-clock time between steps rather than per
 * reading. A browser may stop reporting a phone that holds still (Chromium
 * needs a tenth of a degree of change), and a neutral that moved only per
 * reading froze wherever the last one left it, parking the camera off center
 * until the next bump. Settling ends with an exact snap to center, so a
 * finished glide leaves the horizon level rather than a dead band away from it.
 */
export const createOrientationRig = (
  apply: (yawRad: number, pitchRad: number) => void,
): OrientationRig => {
  const neutral = new Quaternion();
  let latest: Quaternion | undefined;
  let lastStepMs: number | undefined;
  let smoothedYaw = 0;
  let smoothedPitch = 0;
  let appliedYaw = 0;
  let appliedPitch = 0;

  const read = (current: Quaternion) => {
    if (latest === undefined) {
      neutral.copy(current);
    }
    latest = current;
  };

  const step = (nowMs: number) => {
    if (latest === undefined) {
      return false;
    }
    // The first step after a park only starts the clock, so time spent
    // parked never counts as one giant ease.
    const dtMs = lastStepMs === undefined ? 0 : nowMs - lastStepMs;
    lastStepMs = nowMs;
    neutral.slerp(latest, easeFraction(dtMs, RIG_SETTLE_MS));
    const { yawRad, pitchRad } = orientationOffsets(neutral, latest);
    const yaw = clamp(yawRad, {
      min: -RIG_YAW_CLAMP_RAD,
      max: RIG_YAW_CLAMP_RAD,
    });
    const pitch = clamp(pitchRad, {
      min: -RIG_PITCH_CLAMP_RAD,
      max: RIG_PITCH_CLAMP_RAD,
    });
    const ease = easeFraction(dtMs, RIG_SMOOTHING_MS);
    smoothedYaw += (yaw - smoothedYaw) * ease;
    smoothedPitch += (pitch - smoothedPitch) * ease;
    const settled = [yaw, pitch, smoothedYaw, smoothedPitch].every(
      (offset) => Math.abs(offset) < RIG_DEADBAND_RAD,
    );
    if (settled) {
      neutral.copy(latest);
      smoothedYaw = 0;
      smoothedPitch = 0;
      lastStepMs = undefined;
    }
    const moved =
      Math.abs(smoothedYaw - appliedYaw) >= RIG_DEADBAND_RAD ||
      Math.abs(smoothedPitch - appliedPitch) >= RIG_DEADBAND_RAD;
    const offCenter = appliedYaw !== 0 || appliedPitch !== 0;
    if (moved || (settled && offCenter)) {
      appliedYaw = smoothedYaw;
      appliedPitch = smoothedPitch;
      apply(appliedYaw, appliedPitch);
    }
    return !settled;
  };

  return { read, step };
};

/**
 * Pans the chase camera with the phone's orientation, eased and clamped, always
 * gliding back to center as the neutral attitude adapts, so a skewed dash mount
 * or a long curve never parks the view off axis. The glide runs on a frame loop
 * that parks once the camera is centered and wakes on the next reading, and
 * the rig renders only when the offset moves past RIG_DEADBAND_RAD, which is
 * load-bearing for the thermal budget rather than a tuning nicety. Where
 * deviceorientation never fires the loop never starts and the camera holds its
 * base framing.
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
    const rig = createOrientationRig((yawRad, pitchRad) => {
      aimCamera(camera, target, yawRad, pitchRad);
      invalidate();
    });
    // 0 while parked; a pending frame id is never 0.
    let frame = 0;
    const tick = (nowMs: number) => {
      frame = rig.step(nowMs) ? requestAnimationFrame(tick) : 0;
    };

    const handleOrientation = (event: DeviceOrientationEvent) => {
      if (event.alpha === null || event.beta === null || event.gamma === null) {
        return;
      }
      rig.read(
        orientationQuaternion(
          event.alpha,
          event.beta,
          event.gamma,
          window.screen.orientation?.angle ?? 0,
        ),
      );
      // Only a parked loop is woken; a running one reads on its next frame,
      // and a second chain on the one frame id could never be cancelled.
      if (frame === 0) {
        frame = requestAnimationFrame(tick);
      }
    };
    window.addEventListener("deviceorientation", handleOrientation);
    return () => {
      window.removeEventListener("deviceorientation", handleOrientation);
      cancelAnimationFrame(frame);
      camera.lookAt(target);
      invalidate();
    };
  }, [enabled, camera, invalidate]);

  return null;
};
