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
        frameThumbnails: true,
        saveFrames: true,
        autoSaveFrames: false,
        radarAudio: true,
        throttleInference: true,
        centerCropFrames: true,
        zoomMode: "auto",
        confidenceThreshold: 0.5,
        zoomIndicator: true,
        roundTripIndicator: true,
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
        frameThumbnails: true,
        saveFrames: true,
        autoSaveFrames: false,
        radarAudio: true,
        throttleInference: true,
        centerCropFrames: true,
        zoomMode: "auto",
        confidenceThreshold: 0.5,
        zoomIndicator: true,
        roundTripIndicator: true,
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
        frameThumbnails: true,
        saveFrames: true,
        autoSaveFrames: false,
        radarAudio: false,
        throttleInference: true,
        centerCropFrames: true,
        zoomMode: "auto",
        confidenceThreshold: 0.5,
        zoomIndicator: true,
        roundTripIndicator: true,
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
        frameThumbnails: true,
        saveFrames: true,
        autoSaveFrames: false,
        radarAudio: true,
        throttleInference: false,
        centerCropFrames: true,
        zoomMode: "auto",
        confidenceThreshold: 0.5,
        zoomIndicator: true,
        roundTripIndicator: true,
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
        frameThumbnails: true,
        saveFrames: true,
        autoSaveFrames: false,
        radarAudio: true,
        throttleInference: true,
        centerCropFrames: false,
        zoomMode: "auto",
        confidenceThreshold: 0.5,
        zoomIndicator: true,
        roundTripIndicator: true,
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
        frameThumbnails: true,
        saveFrames: true,
        autoSaveFrames: true,
        throttleInference: false,
        centerCropFrames: false,
        zoomMode: "1x",
        zoomIndicator: true,
        roundTripIndicator: true,
      }),
    );
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.showDebug).toBe(false);
    expect(result.current.frameThumbnails).toBe(false);
    expect(result.current.saveFrames).toBe(false);
    expect(result.current.autoSaveFrames).toBe(false);
    expect(result.current.throttleInference).toBe(true);
    expect(result.current.centerCropFrames).toBe(true);
    expect(result.current.zoomIndicator).toBe(false);
    expect(result.current.roundTripIndicator).toBe(false);
    // A fixed-zoom override is a developer tweak; a normal drive always runs
    // the auto default.
    expect(result.current.zoomMode).toBe("auto");
  });

  it("defaults the zoom mode to auto", () => {
    // Auto is the production scanning behavior; the developer row exists to
    // pin a fixed 1x or 2x for testing.
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.zoomMode).toBe("auto");
    act(() => result.current.toggleDeveloperOptions());
    expect(result.current.zoomMode).toBe("auto");
  });

  it("restores a stored zoom override when developerOptions comes back on", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => result.current.toggleDeveloperOptions());
    act(() => result.current.setZoomMode("1x"));
    expect(result.current.zoomMode).toBe("1x");
    act(() => result.current.toggleDeveloperOptions());
    expect(result.current.zoomMode).toBe("auto");
    act(() => result.current.toggleDeveloperOptions());
    expect(result.current.zoomMode).toBe("1x");
  });

  it("migrates a legacy stored zoom2x true to the 2x mode", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true, zoom2x: true }),
    );
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.zoomMode).toBe("2x");
  });

  it("ignores a legacy stored zoom2x false", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true, zoom2x: false }),
    );
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.zoomMode).toBe("auto");
  });

  it("prefers a stored zoomMode over a lingering legacy zoom2x", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        developerOptions: true,
        zoom2x: true,
        zoomMode: "1x",
      }),
    );
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.zoomMode).toBe("1x");
  });

  it("falls back to the auto mode when a stored zoomMode is invalid", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true, zoomMode: "4x" }),
    );
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.zoomMode).toBe("auto");
  });

  // The frame preview and frame saving used to ride along with showDebug; they
  // are separate options now, so each has to flip on its own.
  it("toggles the frame preview independently of the debug overlay", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => result.current.toggleDeveloperOptions());
    act(() => result.current.toggleShowDebug());
    expect(result.current.showDebug).toBe(false);
    expect(result.current.frameThumbnails).toBe(true);

    act(() => result.current.toggleFrameThumbnails());
    expect(result.current.frameThumbnails).toBe(false);
    expect(result.current.saveFrames).toBe(true);
  });

  it("toggles frame saving independently of the debug overlay", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => result.current.toggleDeveloperOptions());
    act(() => result.current.toggleSaveFrames());
    expect(result.current.saveFrames).toBe(false);
    expect(result.current.showDebug).toBe(true);
    expect(result.current.frameThumbnails).toBe(true);
  });

  // Auto save downloads a file per detection, so unlike the other three
  // display options it stays off until asked for by name.
  it("keeps auto save off even once developer options are on", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => result.current.toggleDeveloperOptions());
    expect(result.current.saveFrames).toBe(true);
    expect(result.current.autoSaveFrames).toBe(false);

    act(() => result.current.toggleAutoSaveFrames());
    expect(result.current.autoSaveFrames).toBe(true);
  });

  it("tolerates a stored blob predating the frame preview and saving options", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true, showDebug: false }),
    );
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.frameThumbnails).toBe(true);
    expect(result.current.saveFrames).toBe(true);
    expect(result.current.autoSaveFrames).toBe(false);
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
        frameThumbnails: true,
        saveFrames: true,
        autoSaveFrames: false,
        radarAudio: true,
        throttleInference: true,
        centerCropFrames: false,
        zoomMode: "auto",
        confidenceThreshold: 0.5,
        zoomIndicator: true,
        roundTripIndicator: true,
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
