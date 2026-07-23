import { afterEach, describe, expect, it } from "vitest";
import {
  armWasmSafeMode,
  isWasmSafeModeArmed,
  SAFE_MODE_RELEASE,
  SAFE_MODE_STORAGE_KEY,
} from "./index";

afterEach(() => {
  window.localStorage.clear();
});

describe("backendSafeMode", () => {
  it("reads as unarmed when nothing was stored", () => {
    expect(isWasmSafeModeArmed()).toBe(false);
  });

  it("arms and stays armed across repeated reads", () => {
    armWasmSafeMode();
    expect(isWasmSafeModeArmed()).toBe(true);
    expect(isWasmSafeModeArmed()).toBe(true);
  });

  it("disarms and clears a record from a different release", () => {
    window.localStorage.setItem(
      SAFE_MODE_STORAGE_KEY,
      JSON.stringify({ release: "dashradar@0.0.0+0000000" }),
    );
    expect(isWasmSafeModeArmed()).toBe(false);
    expect(window.localStorage.getItem(SAFE_MODE_STORAGE_KEY)).toBeNull();
  });

  it("keeps a record from the current release", () => {
    window.localStorage.setItem(
      SAFE_MODE_STORAGE_KEY,
      JSON.stringify({ release: SAFE_MODE_RELEASE }),
    );
    expect(isWasmSafeModeArmed()).toBe(true);
    expect(window.localStorage.getItem(SAFE_MODE_STORAGE_KEY)).not.toBeNull();
  });

  it("disarms and clears invalid JSON", () => {
    window.localStorage.setItem(SAFE_MODE_STORAGE_KEY, "{not json");
    expect(isWasmSafeModeArmed()).toBe(false);
    expect(window.localStorage.getItem(SAFE_MODE_STORAGE_KEY)).toBeNull();
  });

  it("disarms and clears a wrong-shape record", () => {
    window.localStorage.setItem(
      SAFE_MODE_STORAGE_KEY,
      JSON.stringify({ armed: true }),
    );
    expect(isWasmSafeModeArmed()).toBe(false);
    expect(window.localStorage.getItem(SAFE_MODE_STORAGE_KEY)).toBeNull();
  });
});
