import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SceneView } from "@/components/SceneView";

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
