import { describe, expect, it } from "vitest";
import {
  integrateYawPitch,
  mapRotationRateToScreen,
  orientationDeltaToPixels,
} from "@/lib/motionSensor";

const rate = (
  beta: number,
  gamma: number,
): { alpha: number; beta: number; gamma: number } => ({
  alpha: 0,
  beta,
  gamma,
});

describe("mapRotationRateToScreen", () => {
  it("maps gamma to yaw and beta to pitch in portrait (angle 0)", () => {
    expect(mapRotationRateToScreen(rate(5, 9), 0)).toEqual({
      yawRate: 9,
      pitchRate: 5,
    });
  });

  it("swaps the axes in landscape (angle 90) so beta drives yaw", () => {
    const screen = mapRotationRateToScreen(rate(5, 9), 90);
    // In landscape a left/right pan comes from the device x-axis (beta).
    expect(Math.abs(screen.yawRate)).toBe(5);
    expect(Math.abs(screen.pitchRate)).toBe(9);
  });
});

describe("integrateYawPitch", () => {
  it("accumulates radians from a deg/s rate over dt", () => {
    const next = integrateYawPitch(
      { yaw: 0, pitch: 0 },
      { yawRate: 90, pitchRate: 0 },
      0.1,
    );
    // 90 deg/s * 0.1s = 9 deg = 0.15708 rad
    expect(next.yaw).toBeCloseTo(((90 * Math.PI) / 180) * 0.1);
    expect(next.pitch).toBe(0);
  });

  it("clamps an overlong dt so a background gap cannot fling the box", () => {
    const clamped = integrateYawPitch(
      { yaw: 0, pitch: 0 },
      { yawRate: 90, pitchRate: 0 },
      5,
    );
    const capped = integrateYawPitch(
      { yaw: 0, pitch: 0 },
      { yawRate: 90, pitchRate: 0 },
      0.1,
    );
    expect(clamped.yaw).toBeCloseTo(capped.yaw);
  });
});

describe("orientationDeltaToPixels", () => {
  const video = { width: 1280, height: 720 };
  const viewport = { width: 800, height: 600 };

  it("returns zero offset for zero rotation", () => {
    expect(
      orientationDeltaToPixels({ yaw: 0, pitch: 0 }, video, viewport),
    ).toEqual({
      dx: 0,
      dy: 0,
    });
  });

  it("moves the box opposite the yaw (pan right -> content shifts left)", () => {
    const { dx } = orientationDeltaToPixels(
      { yaw: 0.1, pitch: 0 },
      video,
      viewport,
    );
    expect(dx).toBeLessThan(0);
  });

  it("scales linearly with the delta", () => {
    const small = orientationDeltaToPixels(
      { yaw: 0.05, pitch: 0 },
      video,
      viewport,
    );
    const big = orientationDeltaToPixels(
      { yaw: 0.1, pitch: 0 },
      video,
      viewport,
    );
    expect(big.dx).toBeCloseTo(small.dx * 2);
  });
});
