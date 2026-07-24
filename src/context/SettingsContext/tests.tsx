import { act, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONFIDENCE_LEVELS,
  SettingsProvider,
  snapConfidence,
  STORAGE_KEY,
  useSettings,
} from "@/context/SettingsContext";

afterEach(() => {
  window.localStorage.clear();
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <SettingsProvider>{children}</SettingsProvider>
);

describe("SettingsContext", () => {
  it("keeps showDebug off out of the box, since developerOptions starts off", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.showDebug).toBe(false);
  });

  it("turns showDebug on with developerOptions, with nothing else to tap", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => result.current.toggleDeveloperOptions());
    expect(result.current.showDebug).toBe(true);
  });

  it("toggling flips showDebug and persists it to localStorage", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => result.current.toggleDeveloperOptions());
    act(() => result.current.toggleShowDebug());
    expect(result.current.showDebug).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        developerOptions: true,
        showDebug: false,
        radarAudio: true,
        throttleInference: true,
        centerCropFrames: true,
        confidenceThreshold: 0.5,
      }),
    );
  });

  it("tolerates a partial stored blob, defaulting missing fields", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ radarAudio: false }),
    );
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.radarAudio).toBe(false);
    expect(result.current.showDebug).toBe(false);
  });

  it("falls back to defaults when stored JSON is corrupt", () => {
    window.localStorage.setItem(STORAGE_KEY, "not json {");
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.showDebug).toBe(false);
  });

  it("falls back to defaults when stored shape is wrong", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ showDebug: 1 }));
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.showDebug).toBe(false);
  });

  it("throws when useSettings is used without a provider", () => {
    const Probe = () => {
      useSettings();
      return null;
    };
    expect(() => render(<Probe />)).toThrow(
      "useSettings must be used within a SettingsProvider",
    );
  });

  it("defaults settingsOpen to false and toggles via open/close", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.settingsOpen).toBe(false);
    act(() => result.current.openSettings());
    expect(result.current.settingsOpen).toBe(true);
    act(() => result.current.closeSettings());
    expect(result.current.settingsOpen).toBe(false);
  });

  it("does not persist the open state to localStorage", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => result.current.openSettings());
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        developerOptions: false,
        showDebug: true,
        radarAudio: true,
        throttleInference: true,
        centerCropFrames: true,
        confidenceThreshold: 0.5,
      }),
    );
  });

  it("defaults radarAudio to true when storage is empty", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.radarAudio).toBe(true);
  });

  it("toggling flips radarAudio and persists it to localStorage", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => result.current.toggleRadarAudio());
    expect(result.current.radarAudio).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        developerOptions: false,
        showDebug: true,
        radarAudio: false,
        throttleInference: true,
        centerCropFrames: true,
        confidenceThreshold: 0.5,
      }),
    );
  });

  it("defaults throttleInference to true when storage is empty", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.throttleInference).toBe(true);
  });

  it("toggling flips throttleInference and persists it to localStorage", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => result.current.toggleDeveloperOptions());
    act(() => result.current.toggleThrottleInference());
    expect(result.current.throttleInference).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        developerOptions: true,
        showDebug: true,
        radarAudio: true,
        throttleInference: false,
        centerCropFrames: true,
        confidenceThreshold: 0.5,
      }),
    );
  });

  it("tolerates a stored blob missing throttleInference, defaulting it to true", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showDebug: true }),
    );
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.throttleInference).toBe(true);
  });

  it("defaults centerCropFrames to true when storage is empty", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.centerCropFrames).toBe(true);
  });

  it("toggling flips centerCropFrames and persists it to localStorage", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => result.current.toggleDeveloperOptions());
    act(() => result.current.toggleCenterCropFrames());
    expect(result.current.centerCropFrames).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        developerOptions: true,
        showDebug: true,
        radarAudio: true,
        throttleInference: true,
        centerCropFrames: false,
        confidenceThreshold: 0.5,
      }),
    );
  });

  it("tolerates a stored blob missing centerCropFrames, defaulting it to true", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showDebug: true }),
    );
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.centerCropFrames).toBe(true);
  });

  it("defaults developerOptions to false when storage is empty", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.developerOptions).toBe(false);
  });

  it("reports every developer option at its off-switch value while developerOptions is off", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        developerOptions: false,
        showDebug: true,
        throttleInference: false,
        centerCropFrames: false,
      }),
    );
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.showDebug).toBe(false);
    expect(result.current.throttleInference).toBe(true);
    expect(result.current.centerCropFrames).toBe(true);
  });

  it("restores the stored developer options when developerOptions is turned back on", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => result.current.toggleDeveloperOptions());
    act(() => result.current.toggleThrottleInference());
    expect(result.current.throttleInference).toBe(false);
    expect(result.current.showDebug).toBe(true);

    // Off: both revert to their off-switch values for the rest of the drive.
    act(() => result.current.toggleDeveloperOptions());
    expect(result.current.throttleInference).toBe(true);
    expect(result.current.showDebug).toBe(false);

    // Back on: the tweak comes back rather than having been reset.
    act(() => result.current.toggleDeveloperOptions());
    expect(result.current.throttleInference).toBe(false);
    expect(result.current.showDebug).toBe(true);
  });

  it("keeps persisting the stored developer options while developerOptions is off", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => result.current.toggleDeveloperOptions());
    act(() => result.current.toggleCenterCropFrames());
    act(() => result.current.toggleDeveloperOptions());
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        developerOptions: false,
        showDebug: true,
        radarAudio: true,
        throttleInference: true,
        centerCropFrames: false,
        confidenceThreshold: 0.5,
      }),
    );
  });

  it("defaults minimum confidence to 0.5", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.confidenceThreshold).toBe(0.5);
  });

  it("forces confidence to 0.5 while developer options are off", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: false, confidenceThreshold: 0.2 }),
    );
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.confidenceThreshold).toBe(0.5);
  });

  it("reports the stored confidence once developer options are on", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true, confidenceThreshold: 0.2 }),
    );
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.confidenceThreshold).toBe(0.2);
  });

  it("setConfidenceThreshold snaps an off-step value to the nearest level", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => result.current.toggleDeveloperOptions());
    act(() => result.current.setConfidenceThreshold(0.27));
    expect(result.current.confidenceThreshold).toBe(0.3);
  });

  it("snaps a corrupt stored confidence to a valid level", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true, confidenceThreshold: 5 }),
    );
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(CONFIDENCE_LEVELS).toContain(result.current.confidenceThreshold);
  });

  it("persists confidence and leaves the stored value when developer options go off", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => result.current.toggleDeveloperOptions());
    act(() => result.current.setConfidenceThreshold(0.3));
    act(() => result.current.toggleDeveloperOptions());
    expect(result.current.confidenceThreshold).toBe(0.5);
    act(() => result.current.toggleDeveloperOptions());
    expect(result.current.confidenceThreshold).toBe(0.3);
  });
});

describe("snapConfidence", () => {
  it("resolves a non-finite value to the 0.5 default", () => {
    expect(snapConfidence(NaN)).toBe(0.5);
    expect(snapConfidence(Infinity)).toBe(0.5);
    expect(snapConfidence(-Infinity)).toBe(0.5);
  });

  it("snaps an off-step value to the nearest allowed level", () => {
    expect(snapConfidence(0.27)).toBe(0.3);
    expect(snapConfidence(0.84)).toBe(0.8);
  });

  it("clamps an out-of-range value to the nearest end step", () => {
    expect(snapConfidence(5)).toBe(0.9);
    expect(snapConfidence(-2)).toBe(0.1);
  });
});
