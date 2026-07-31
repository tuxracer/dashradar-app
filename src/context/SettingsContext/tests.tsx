import { act, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONFIDENCE_LEVELS,
  SETTINGS_VERSION,
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

  // Turning the master switch on reveals the developer rows and does nothing
  // else: every one of them stays where it was until someone taps it.
  it("turns nothing on when developerOptions is switched on", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => result.current.toggleDeveloperOptions());
    expect(result.current.developerOptions).toBe(true);
    expect(result.current.showDebug).toBe(false);
    expect(result.current.frameThumbnails).toBe(false);
    expect(result.current.saveFrames).toBe(false);
    expect(result.current.autoSaveFrames).toBe(false);
    expect(result.current.zoomIndicator).toBe(false);
    expect(result.current.roundTripIndicator).toBe(false);
    expect(result.current.cameraPreview).toBe(false);
    expect(result.current.throttleInference).toBe(true);
    expect(result.current.zoomMode).toBe("auto");
    expect(result.current.confidenceThreshold).toBe(0.5);
  });

  it("toggling flips showDebug and persists it to localStorage", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => result.current.toggleDeveloperOptions());
    act(() => result.current.toggleShowDebug());
    expect(result.current.showDebug).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        settingsVersion: SETTINGS_VERSION,
        developerOptions: true,
        showDebug: true,
        frameThumbnails: false,
        saveFrames: false,
        autoSaveFrames: false,
        radarAudio: true,
        detectionImage: true,
        throttleInference: true,
        zoomMode: "auto",
        confidenceThreshold: 0.5,
        zoomIndicator: false,
        roundTripIndicator: false,
        cameraPreview: false,
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
        settingsVersion: SETTINGS_VERSION,
        developerOptions: false,
        showDebug: false,
        frameThumbnails: false,
        saveFrames: false,
        autoSaveFrames: false,
        radarAudio: true,
        detectionImage: true,
        throttleInference: true,
        zoomMode: "auto",
        confidenceThreshold: 0.5,
        zoomIndicator: false,
        roundTripIndicator: false,
        cameraPreview: false,
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
        settingsVersion: SETTINGS_VERSION,
        developerOptions: false,
        showDebug: false,
        frameThumbnails: false,
        saveFrames: false,
        autoSaveFrames: false,
        radarAudio: false,
        detectionImage: true,
        throttleInference: true,
        zoomMode: "auto",
        confidenceThreshold: 0.5,
        zoomIndicator: false,
        roundTripIndicator: false,
        cameraPreview: false,
      }),
    );
  });

  it("defaults detectionImage to true when storage is empty", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.detectionImage).toBe(true);
  });

  // A normal-drive setting, not a developer one: it stays exactly as the driver
  // left it whatever the master switch does.
  it("keeps detectionImage off while developer options are off", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ detectionImage: false }),
    );
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.developerOptions).toBe(false);
    expect(result.current.detectionImage).toBe(false);
  });

  it("toggling flips detectionImage and persists it to localStorage", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => result.current.toggleDetectionImage());
    expect(result.current.detectionImage).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        settingsVersion: SETTINGS_VERSION,
        developerOptions: false,
        showDebug: false,
        frameThumbnails: false,
        saveFrames: false,
        autoSaveFrames: false,
        radarAudio: true,
        detectionImage: false,
        throttleInference: true,
        zoomMode: "auto",
        confidenceThreshold: 0.5,
        zoomIndicator: false,
        roundTripIndicator: false,
        cameraPreview: false,
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
        settingsVersion: SETTINGS_VERSION,
        developerOptions: true,
        showDebug: false,
        frameThumbnails: false,
        saveFrames: false,
        autoSaveFrames: false,
        radarAudio: true,
        detectionImage: true,
        throttleInference: false,
        zoomMode: "auto",
        confidenceThreshold: 0.5,
        zoomIndicator: false,
        roundTripIndicator: false,
        cameraPreview: false,
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
        zoomMode: "1x",
        zoomIndicator: true,
        roundTripIndicator: true,
        cameraPreview: true,
      }),
    );
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.showDebug).toBe(false);
    expect(result.current.frameThumbnails).toBe(false);
    expect(result.current.saveFrames).toBe(false);
    expect(result.current.autoSaveFrames).toBe(false);
    expect(result.current.throttleInference).toBe(true);
    expect(result.current.zoomIndicator).toBe(false);
    expect(result.current.roundTripIndicator).toBe(false);
    expect(result.current.cameraPreview).toBe(false);
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

  // A blob from before the developer options stopped defaulting on stores the
  // five display options as true whether or not anyone chose them, so it is
  // migrated to off on load.
  it("turns off the developer options a pre-version blob defaulted on", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        developerOptions: true,
        showDebug: true,
        frameThumbnails: true,
        saveFrames: true,
        zoomIndicator: true,
        roundTripIndicator: true,
      }),
    );
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.developerOptions).toBe(true);
    expect(result.current.showDebug).toBe(false);
    expect(result.current.frameThumbnails).toBe(false);
    expect(result.current.saveFrames).toBe(false);
    expect(result.current.zoomIndicator).toBe(false);
    expect(result.current.roundTripIndicator).toBe(false);
  });

  it("keeps the deliberate options a pre-version blob stored", () => {
    // None of these could be there by default, so each one is a choice someone
    // made and the migration leaves it alone.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        developerOptions: true,
        autoSaveFrames: true,
        cameraPreview: true,
        throttleInference: false,
        zoomMode: "1x",
        confidenceThreshold: 0.2,
        radarAudio: false,
        detectionImage: false,
      }),
    );
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.autoSaveFrames).toBe(true);
    expect(result.current.cameraPreview).toBe(true);
    expect(result.current.throttleInference).toBe(false);
    expect(result.current.zoomMode).toBe("1x");
    expect(result.current.confidenceThreshold).toBe(0.2);
    expect(result.current.radarAudio).toBe(false);
    expect(result.current.detectionImage).toBe(false);
  });

  it("does not re-run the migration over a choice made after it", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true, showDebug: true }),
    );
    const first = renderHook(() => useSettings(), { wrapper });
    expect(first.result.current.showDebug).toBe(false);
    act(() => first.result.current.toggleShowDebug());
    first.unmount();

    const second = renderHook(() => useSettings(), { wrapper });
    expect(second.result.current.showDebug).toBe(true);
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
    expect(result.current.showDebug).toBe(true);
    expect(result.current.frameThumbnails).toBe(false);

    act(() => result.current.toggleFrameThumbnails());
    expect(result.current.frameThumbnails).toBe(true);
    expect(result.current.saveFrames).toBe(false);
  });

  it("toggles frame saving independently of the debug overlay", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => result.current.toggleDeveloperOptions());
    act(() => result.current.toggleSaveFrames());
    expect(result.current.saveFrames).toBe(true);
    expect(result.current.showDebug).toBe(false);
    expect(result.current.frameThumbnails).toBe(false);
  });

  it("turns the camera preview on only when it is asked for by name", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => result.current.toggleDeveloperOptions());
    expect(result.current.cameraPreview).toBe(false);

    act(() => result.current.toggleCameraPreview());
    expect(result.current.cameraPreview).toBe(true);
  });

  it("turns auto save on only when it is asked for by name", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => result.current.toggleDeveloperOptions());
    expect(result.current.autoSaveFrames).toBe(false);

    act(() => result.current.toggleAutoSaveFrames());
    expect(result.current.autoSaveFrames).toBe(true);
  });

  it("tolerates a stored blob predating the frame preview and saving options", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        settingsVersion: SETTINGS_VERSION,
        developerOptions: true,
        showDebug: true,
      }),
    );
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.showDebug).toBe(true);
    expect(result.current.frameThumbnails).toBe(false);
    expect(result.current.saveFrames).toBe(false);
    expect(result.current.autoSaveFrames).toBe(false);
  });

  it("restores the stored developer options when developerOptions is turned back on", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => result.current.toggleDeveloperOptions());
    act(() => result.current.toggleThrottleInference());
    act(() => result.current.toggleShowDebug());
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
    act(() => result.current.toggleFrameThumbnails());
    act(() => result.current.toggleDeveloperOptions());
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        settingsVersion: SETTINGS_VERSION,
        developerOptions: false,
        showDebug: false,
        frameThumbnails: true,
        saveFrames: false,
        autoSaveFrames: false,
        radarAudio: true,
        detectionImage: true,
        throttleInference: true,
        zoomMode: "auto",
        confidenceThreshold: 0.5,
        zoomIndicator: false,
        roundTripIndicator: false,
        cameraPreview: false,
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
