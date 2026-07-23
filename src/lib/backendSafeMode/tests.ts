import { afterEach, describe, expect, it } from "vitest";
import { APP_RELEASE } from "@/lib/appRelease";
import type { PreviousSessionEnd } from "@/lib/crashSentinel";
import {
  isWasmSafeModeArmed,
  recordWebGpuCrash,
  resetWebGpuCrashStreak,
  SAFE_MODE_CRASH_THRESHOLD,
  SAFE_MODE_STORAGE_KEY,
  shouldCountWebGpuCrash,
} from "./index";

afterEach(() => {
  window.localStorage.clear();
});

/** A previous-session classification that should count toward safe mode. */
const webGpuCrash = (
  overrides: Partial<PreviousSessionEnd> = {},
): PreviousSessionEnd => ({
  outcome: "crash",
  gapMs: 0,
  uptimeMs: 1_000,
  framesProcessed: 3,
  backend: "webgpu",
  graphCapture: true,
  release: APP_RELEASE,
  ...overrides,
});

describe("shouldCountWebGpuCrash", () => {
  it("counts a webgpu crash from the current release", () => {
    expect(shouldCountWebGpuCrash(webGpuCrash())).toBe(true);
  });

  it("does not count when there was no previous dirty session", () => {
    expect(shouldCountWebGpuCrash(undefined)).toBe(false);
  });

  it("does not count an unclean end", () => {
    expect(shouldCountWebGpuCrash(webGpuCrash({ outcome: "unclean" }))).toBe(
      false,
    );
  });

  it("does not count a crash on the wasm backend", () => {
    expect(shouldCountWebGpuCrash(webGpuCrash({ backend: "wasm" }))).toBe(
      false,
    );
  });

  it("does not count a crash record left by a different release", () => {
    expect(
      shouldCountWebGpuCrash(
        webGpuCrash({ release: "dashradar@0.0.0+0000000" }),
      ),
    ).toBe(false);
  });

  it("does not count a crash record with no release stamp", () => {
    expect(shouldCountWebGpuCrash(webGpuCrash({ release: undefined }))).toBe(
      false,
    );
  });
});

describe("recordWebGpuCrash / isWasmSafeModeArmed", () => {
  it("reads as unarmed when nothing was stored", () => {
    expect(isWasmSafeModeArmed()).toBe(false);
  });

  it("does not arm on a single crash", () => {
    recordWebGpuCrash();
    expect(isWasmSafeModeArmed()).toBe(false);
  });

  it("arms once the crash streak reaches the threshold and stays armed", () => {
    for (let i = 0; i < SAFE_MODE_CRASH_THRESHOLD; i += 1) {
      recordWebGpuCrash();
    }
    expect(isWasmSafeModeArmed()).toBe(true);
    expect(isWasmSafeModeArmed()).toBe(true);
  });

  it("restarts the streak over a record from a different release", () => {
    window.localStorage.setItem(
      SAFE_MODE_STORAGE_KEY,
      JSON.stringify({ release: "dashradar@0.0.0+0000000", crashes: 5 }),
    );
    recordWebGpuCrash();
    expect(isWasmSafeModeArmed()).toBe(false);
  });

  it("disarms and clears a record from a different release", () => {
    window.localStorage.setItem(
      SAFE_MODE_STORAGE_KEY,
      JSON.stringify({ release: "dashradar@0.0.0+0000000", crashes: 5 }),
    );
    expect(isWasmSafeModeArmed()).toBe(false);
    expect(window.localStorage.getItem(SAFE_MODE_STORAGE_KEY)).toBeNull();
  });

  it("disarms and clears invalid JSON", () => {
    window.localStorage.setItem(SAFE_MODE_STORAGE_KEY, "{not json");
    expect(isWasmSafeModeArmed()).toBe(false);
    expect(window.localStorage.getItem(SAFE_MODE_STORAGE_KEY)).toBeNull();
  });

  it("disarms and clears a record without a crash count (old shape)", () => {
    window.localStorage.setItem(
      SAFE_MODE_STORAGE_KEY,
      JSON.stringify({ release: APP_RELEASE }),
    );
    expect(isWasmSafeModeArmed()).toBe(false);
    expect(window.localStorage.getItem(SAFE_MODE_STORAGE_KEY)).toBeNull();
  });
});

describe("resetWebGpuCrashStreak", () => {
  it("clears a below-threshold streak so the next crash starts from one", () => {
    recordWebGpuCrash();
    resetWebGpuCrashStreak();
    recordWebGpuCrash();
    expect(isWasmSafeModeArmed()).toBe(false);
  });

  it("keeps an armed record so a clean wasm session cannot disarm it", () => {
    for (let i = 0; i < SAFE_MODE_CRASH_THRESHOLD; i += 1) {
      recordWebGpuCrash();
    }
    resetWebGpuCrashStreak();
    expect(isWasmSafeModeArmed()).toBe(true);
  });

  it("is a no-op when nothing was stored", () => {
    resetWebGpuCrashStreak();
    expect(window.localStorage.getItem(SAFE_MODE_STORAGE_KEY)).toBeNull();
    expect(isWasmSafeModeArmed()).toBe(false);
  });
});
