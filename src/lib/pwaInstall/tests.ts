import { track } from "@vercel/analytics";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PWA_INSTALL_TRACKED_KEY,
  isStandalone,
  trackPwaInstall,
} from "@/lib/pwaInstall";

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

/** Stub window.matchMedia so the display-mode query reports `matches`. */
const stubDisplayMode = (matches: boolean) => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches })),
  );
};

/** Set the non-standard iOS navigator.standalone flag for one test. */
const stubIosStandalone = (value: boolean) => {
  Object.defineProperty(window.navigator, "standalone", {
    configurable: true,
    value,
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(track).mockClear();
  window.localStorage.clear();
  Reflect.deleteProperty(window.navigator, "standalone");
});

describe("isStandalone", () => {
  it("is true when the display-mode is standalone", () => {
    stubDisplayMode(true);
    expect(isStandalone()).toBe(true);
  });

  it("is true via the legacy iOS navigator.standalone flag", () => {
    stubDisplayMode(false);
    stubIosStandalone(true);
    expect(isStandalone()).toBe(true);
  });

  it("is false in a plain browser tab", () => {
    stubDisplayMode(false);
    expect(isStandalone()).toBe(false);
  });

  it("is false when matchMedia is unavailable and iOS flag is absent", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(isStandalone()).toBe(false);
  });
});

describe("trackPwaInstall", () => {
  it("reports the event once on a standalone launch and sets the flag", () => {
    stubDisplayMode(true);
    trackPwaInstall();
    expect(track).toHaveBeenCalledExactlyOnceWith("pwa_installed");
    expect(window.localStorage.getItem(PWA_INSTALL_TRACKED_KEY)).toBe("1");
  });

  it("does not report again when the flag is already set", () => {
    window.localStorage.setItem(PWA_INSTALL_TRACKED_KEY, "1");
    stubDisplayMode(true);
    trackPwaInstall();
    expect(track).not.toHaveBeenCalled();
  });

  it("does not report on a plain browser-tab launch", () => {
    stubDisplayMode(false);
    trackPwaInstall();
    expect(track).not.toHaveBeenCalled();
  });

  it("reports once when Chromium fires appinstalled", () => {
    stubDisplayMode(false);
    trackPwaInstall();
    expect(track).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("appinstalled"));
    expect(track).toHaveBeenCalledExactlyOnceWith("pwa_installed");
  });

  it("dedupes the standalone and appinstalled paths with one flag", () => {
    stubDisplayMode(true);
    trackPwaInstall();
    window.dispatchEvent(new Event("appinstalled"));
    expect(track).toHaveBeenCalledExactlyOnceWith("pwa_installed");
  });
});
