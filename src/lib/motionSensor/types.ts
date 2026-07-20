import { isString } from "remeda";

/** Cumulative device orientation in radians, screen-aligned (yaw = pan, pitch = tilt). */
export type YawPitch = { yaw: number; pitch: number };

/** Angular velocity from a `devicemotion` event, in degrees per second. */
export type RotationRate = { alpha: number; beta: number; gamma: number };

/** Motion-sensor permission state. "unsupported" means no DeviceMotion at all. */
export type MotionPermission = "unsupported" | "prompt" | "granted" | "denied";

const MOTION_PERMISSIONS: readonly MotionPermission[] = [
  "unsupported",
  "prompt",
  "granted",
  "denied",
];

/** Validates that a value is one of the allowed MotionPermission strings. */
export const isMotionPermission = (value: unknown): value is MotionPermission =>
  isString(value) && MOTION_PERMISSIONS.includes(value as MotionPermission);
