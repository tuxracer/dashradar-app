import { afterEach, describe, expect, it, vi } from "vitest";
import { isDesktopDevice } from "@/lib/deviceType";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isDesktopDevice", () => {
  it("returns true when the fine hover-capable pointer query matches", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    expect(isDesktopDevice()).toBe(true);
  });

  it("returns false when the pointer query does not match", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
    expect(isDesktopDevice()).toBe(false);
  });

  it("treats a missing matchMedia as mobile", () => {
    expect(isDesktopDevice()).toBe(false);
  });
});
