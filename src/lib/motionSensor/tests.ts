import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMotionSensorManager,
  integrateYawPitch,
  mapRotationRateToScreen,
  orientationDeltaToPixels,
} from "@/lib/motionSensor";
import type { RotationRate } from "@/lib/motionSensor";

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

  it("swaps and signs the axes for landscape angle 90", () => {
    expect(mapRotationRateToScreen(rate(5, 9), 90)).toEqual({
      yawRate: -5,
      pitchRate: 9,
    });
  });

  it("negates both axes at angle 180", () => {
    expect(mapRotationRateToScreen(rate(5, 9), 180)).toEqual({
      yawRate: -9,
      pitchRate: -5,
    });
  });

  it("swaps and signs the axes for landscape angle 270", () => {
    expect(mapRotationRateToScreen(rate(5, 9), 270)).toEqual({
      yawRate: 5,
      pitchRate: -9,
    });
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

  it("moves the box down for a positive pitch (pitch is not negated)", () => {
    const { dy } = orientationDeltaToPixels(
      { yaw: 0, pitch: 0.1 },
      video,
      viewport,
    );
    expect(dy).toBeGreaterThan(0);
  });
});

describe("createMotionSensorManager", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  const dispatchMotion = (beta: number, gamma: number) => {
    const event = new Event("devicemotion") as DeviceMotionEvent & {
      rotationRate: RotationRate;
    };
    Object.defineProperty(event, "rotationRate", {
      value: { alpha: 0, beta, gamma },
      configurable: true,
    });
    window.dispatchEvent(event);
  };

  it("integrates rotationRate across events using elapsed time", () => {
    const now = vi.spyOn(performance, "now");
    now.mockReturnValueOnce(1000); // first event seeds the clock, no integration
    now.mockReturnValueOnce(1100); // +100ms
    const manager = createMotionSensorManager();
    manager.start();
    dispatchMotion(0, 90); // portrait: gamma -> yaw
    dispatchMotion(0, 90);
    expect(manager.getYawPitch().yaw).toBeCloseTo(((90 * Math.PI) / 180) * 0.1);
    manager.stop();
  });

  it("reports 'granted' when no permission gate exists (Android/desktop)", () => {
    vi.stubGlobal("DeviceMotionEvent", class {});
    expect(createMotionSensorManager().getPermission()).toBe("granted");
  });

  it("reports 'prompt' on iOS before granting and 'granted' after", async () => {
    const requestPermission = vi.fn(() => Promise.resolve("granted"));
    vi.stubGlobal(
      "DeviceMotionEvent",
      Object.assign(class {}, { requestPermission }),
    );
    const manager = createMotionSensorManager();
    expect(manager.getPermission()).toBe("prompt");
    await expect(manager.requestPermission()).resolves.toBe("granted");
    expect(requestPermission).toHaveBeenCalled();
    expect(localStorage.getItem("dashradar:motionGranted")).toBe("true");
  });

  it("reports 'denied' when the iOS prompt is refused", async () => {
    vi.stubGlobal(
      "DeviceMotionEvent",
      Object.assign(class {}, {
        requestPermission: () => Promise.resolve("denied"),
      }),
    );
    await expect(createMotionSensorManager().requestPermission()).resolves.toBe(
      "denied",
    );
  });
});
