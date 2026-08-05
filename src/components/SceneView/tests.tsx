import { act, render, renderHook, screen } from "@testing-library/react";
import { Quaternion, Vector3 } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DARK_SCENE_PALETTE,
  LIGHT_SCENE_PALETTE,
  orientationOffsets,
  orientationQuaternion,
  SceneView,
  useScenePalette,
} from "@/components/SceneView";

/**
 * jsdom has no WebGL and no ResizeObserver, so the r3f Canvas can never mount
 * here; these tests cover the probe-guard fallback path, which is exactly
 * what a real device with a dead GPU process would take. Rendering itself is
 * browser-verification territory.
 */
describe("SceneView", () => {
  const renderView = (onRenderFailure: () => void) =>
    render(
      <SceneView
        tracks={[]}
        fovDeg={68}
        confidence={0}
        audioEnabled={false}
        onRenderFailure={onRenderFailure}
      />,
    );

  it("renders nothing where WebGL is unavailable", () => {
    renderView(() => {});
    expect(screen.queryByTestId("scene-view")).toBeNull();
  });

  it("reports render failure exactly once", () => {
    const onRenderFailure = vi.fn();
    const { rerender } = renderView(onRenderFailure);
    rerender(
      <SceneView
        tracks={[]}
        fovDeg={68}
        confidence={0.5}
        audioEnabled={false}
        onRenderFailure={onRenderFailure}
      />,
    );
    expect(onRenderFailure).toHaveBeenCalledTimes(1);
  });
});

describe("useScenePalette", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * A matchMedia whose answer can be changed after the fact, with the
   * listeners it was handed, so a test can play the phone switching schemes
   * mid-session.
   */
  const stubScheme = (light: boolean) => {
    const listeners = new Set<() => void>();
    const query = {
      matches: light,
      addEventListener: (_: string, listener: () => void) =>
        listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) =>
        listeners.delete(listener),
    };
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => query),
    );
    return (nowLight: boolean) => {
      query.matches = nowLight;
      act(() => {
        for (const listener of listeners) {
          listener();
        }
      });
    };
  };

  it("stays dark where the color scheme cannot be read", () => {
    const { result } = renderHook(() => useScenePalette());
    expect(result.current).toBe(DARK_SCENE_PALETTE);
  });

  it("stays dark for a scheme that is not light", () => {
    stubScheme(false);
    const { result } = renderHook(() => useScenePalette());
    expect(result.current).toBe(DARK_SCENE_PALETTE);
  });

  it("takes the light palette for a light scheme", () => {
    stubScheme(true);
    const { result } = renderHook(() => useScenePalette());
    expect(result.current).toBe(LIGHT_SCENE_PALETTE);
  });

  it("follows a scheme change without a remount", () => {
    const setScheme = stubScheme(false);
    const { result } = renderHook(() => useScenePalette());
    setScheme(true);
    expect(result.current).toBe(LIGHT_SCENE_PALETTE);
    setScheme(false);
    expect(result.current).toBe(DARK_SCENE_PALETTE);
  });
});

describe("orientationOffsets", () => {
  const IDENTITY = new Quaternion();

  it("reports zero offsets for an unchanged attitude", () => {
    const { yawRad, pitchRad } = orientationOffsets(IDENTITY, IDENTITY);
    expect(yawRad).toBeCloseTo(0);
    expect(pitchRad).toBeCloseTo(0);
  });

  it("reads a turn about the vertical axis as yaw alone", () => {
    const turned = new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      0.25,
    );
    const { yawRad, pitchRad } = orientationOffsets(IDENTITY, turned);
    expect(yawRad).toBeCloseTo(0.25);
    expect(pitchRad).toBeCloseTo(0);
  });

  it("reads a tilt about the lateral axis as pitch alone", () => {
    const tilted = new Quaternion().setFromAxisAngle(
      new Vector3(1, 0, 0),
      0.12,
    );
    const { yawRad, pitchRad } = orientationOffsets(IDENTITY, tilted);
    expect(pitchRad).toBeCloseTo(0.12);
    expect(yawRad).toBeCloseTo(0);
  });

  it("drops roll entirely", () => {
    const rolled = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.3);
    const { yawRad, pitchRad } = orientationOffsets(IDENTITY, rolled);
    expect(yawRad).toBeCloseTo(0);
    expect(pitchRad).toBeCloseTo(0);
  });
});

describe("orientationQuaternion", () => {
  it("is deterministic for one reading", () => {
    const a = orientationQuaternion(30, 45, 10, 0);
    const b = orientationQuaternion(30, 45, 10, 0);
    expect(a.equals(b)).toBe(true);
  });

  it("compensates for the screen orientation angle", () => {
    const portrait = orientationQuaternion(30, 45, 10, 0);
    const landscape = orientationQuaternion(30, 45, 10, 90);
    expect(portrait.equals(landscape)).toBe(false);
  });
});
