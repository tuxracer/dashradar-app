import { render, screen } from "@testing-library/react";
import { Quaternion, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import {
  orientationOffsets,
  orientationQuaternion,
  SceneView,
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
