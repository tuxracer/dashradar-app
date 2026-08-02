import { track } from "@vercel/analytics";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LAST_RUN_COMMIT_KEY, trackAppUpdate } from "@/lib/appUpdate";

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

// The build's own SHA is a compile-time define, so tests compare against it
// rather than pinning a value the bundler would have replaced anyway.
const RUNNING_SHA = __COMMIT_SHA__;

afterEach(() => {
  vi.mocked(track).mockClear();
  window.localStorage.clear();
});

describe("trackAppUpdate", () => {
  it("reports the transition when the build changed", () => {
    window.localStorage.setItem(LAST_RUN_COMMIT_KEY, "0000000");

    trackAppUpdate();

    expect(track).toHaveBeenCalledWith("app_updated", {
      from: "0000000",
      to: RUNNING_SHA,
    });
    expect(window.localStorage.getItem(LAST_RUN_COMMIT_KEY)).toBe(RUNNING_SHA);
  });

  it("records the build silently on a first run", () => {
    trackAppUpdate();

    expect(track).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(LAST_RUN_COMMIT_KEY)).toBe(RUNNING_SHA);
  });

  it("reports nothing when the same build launches again", () => {
    trackAppUpdate();
    trackAppUpdate();

    expect(track).not.toHaveBeenCalled();
  });

  it("reports nothing when storage cannot be read", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    expect(() => trackAppUpdate()).not.toThrow();
    expect(track).not.toHaveBeenCalled();
  });
});
