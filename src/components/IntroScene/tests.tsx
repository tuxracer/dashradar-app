import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntroScene } from "@/components/IntroScene";
import type { IntroSceneRenderer } from "@/components/IntroScene";

/** Builds a stub renderer whose calls the tests can observe. */
const stubRenderer = (): IntroSceneRenderer => ({
  render: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
});

/** Makes prefers-reduced-motion report the given value. */
const stubReducedMotion = (reduced: boolean) => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: reduced })),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("IntroScene", () => {
  it("renders an empty container when the renderer is unavailable", () => {
    stubReducedMotion(false);
    const { container } = render(<IntroScene createRenderer={() => null} />);
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("falls back to no canvas under jsdom's missing WebGL", () => {
    stubReducedMotion(false);
    // No createRenderer override: the real factory runs and must return null
    // (jsdom has no webgl2 context) without throwing.
    const { container } = render(<IntroScene />);
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("sizes the drawing buffer and starts the loop when the renderer exists", () => {
    stubReducedMotion(false);
    const renderer = stubRenderer();
    render(<IntroScene createRenderer={() => renderer} />);
    expect(renderer.resize).toHaveBeenCalled();
  });

  it("draws a single static frame under prefers-reduced-motion", () => {
    stubReducedMotion(true);
    const raf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    const renderer = stubRenderer();
    render(<IntroScene createRenderer={() => renderer} />);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(raf).not.toHaveBeenCalled();
  });

  it("disposes the renderer on unmount", () => {
    stubReducedMotion(false);
    const renderer = stubRenderer();
    const { unmount } = render(<IntroScene createRenderer={() => renderer} />);
    unmount();
    expect(renderer.dispose).toHaveBeenCalled();
  });
});
