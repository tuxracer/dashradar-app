import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BEAT_LOOP_MS,
  CONTACT_APPEAR_MS,
  CONTACT_EXIT_MS,
  PORTRAIT_TUNING,
} from "./consts";
import { IntroScene } from "./index";
import type { IntroSceneHandle } from "./scene";
import { contactStateAt, createIntroScene } from "./scene";

afterEach(cleanup);

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  return () => vi.unstubAllGlobals();
});

const fakeScene = (): IntroSceneHandle => ({
  step: vi.fn(() => null),
  resize: vi.fn(),
  dispose: vi.fn(),
});

describe("IntroScene component", () => {
  it("renders nothing after scene creation fails, leaving the backdrop visible", async () => {
    const { container } = render(<IntroScene createScene={() => null} />);
    await waitFor(() => expect(container.querySelector("canvas")).toBeNull());
  });

  it("disposes the scene on unmount", () => {
    const scene = fakeScene();
    const { unmount } = render(<IntroScene createScene={() => scene} />);
    unmount();
    expect(scene.dispose).toHaveBeenCalledOnce();
  });

  it("renders a single static frame under prefers-reduced-motion", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const scene = fakeScene();
    render(<IntroScene createScene={() => scene} />);
    expect(scene.step).toHaveBeenCalledOnce();
  });
});

describe("createIntroScene", () => {
  it("returns null when a 2D context cannot be created (jsdom)", () => {
    const canvas = document.createElement("canvas");
    expect(createIntroScene(canvas, 400, 800)).toBeNull();
  });
});

describe("contactStateAt", () => {
  it("has no contact during the ambient phase", () => {
    expect(contactStateAt(0, PORTRAIT_TUNING).present).toBe(false);
    expect(contactStateAt(CONTACT_APPEAR_MS - 1, PORTRAIT_TUNING).present).toBe(
      false,
    );
    expect(contactStateAt(CONTACT_EXIT_MS + 1, PORTRAIT_TUNING).present).toBe(
      false,
    );
    expect(contactStateAt(BEAT_LOOP_MS - 1, PORTRAIT_TUNING).present).toBe(
      false,
    );
  });

  it("moves the contact from spawn depth toward the camera", () => {
    const early = contactStateAt(CONTACT_APPEAR_MS + 100, PORTRAIT_TUNING);
    const late = contactStateAt(CONTACT_EXIT_MS - 100, PORTRAIT_TUNING);
    if (!early.present || !late.present) throw new Error("contact missing");
    expect(early.z).toBeGreaterThan(late.z);
  });

  it("locks on only inside the lock depth window", () => {
    const justSpawned = contactStateAt(CONTACT_APPEAR_MS + 50, PORTRAIT_TUNING);
    if (!justSpawned.present) throw new Error("contact missing");
    expect(justSpawned.lockOn).toBe(false);

    const mid = contactStateAt(6_800, PORTRAIT_TUNING);
    if (!mid.present) throw new Error("contact missing");
    expect(mid.lockOn).toBe(true);
    expect(mid.sinceLockMs).toBeGreaterThan(0);
  });

  it("wraps times beyond one loop back into the loop", () => {
    const wrapped = contactStateAt(BEAT_LOOP_MS + 6_800, PORTRAIT_TUNING);
    expect(wrapped.present).toBe(true);
  });
});
