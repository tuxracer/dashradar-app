import { act, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  SettingsProvider,
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
  it("defaults showDebug to false when storage is empty", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.showDebug).toBe(false);
  });

  it("toggling flips showDebug and persists it to localStorage", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => result.current.toggleDeveloperOptions());
    act(() => result.current.toggleShowDebug());
    expect(result.current.showDebug).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        developerOptions: true,
        showDebug: true,
        radarAudio: true,
        throttleInference: true,
        centerCropFrames: true,
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
        showDebug: false,
        radarAudio: true,
        throttleInference: true,
        centerCropFrames: true,
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
        showDebug: false,
        radarAudio: false,
        throttleInference: true,
        centerCropFrames: true,
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
        showDebug: false,
        radarAudio: true,
        throttleInference: false,
        centerCropFrames: true,
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
        showDebug: false,
        radarAudio: true,
        throttleInference: true,
        centerCropFrames: false,
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

  it("reports every developer option at its default while developerOptions is off", () => {
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
    act(() => result.current.toggleShowDebug());
    expect(result.current.throttleInference).toBe(false);
    expect(result.current.showDebug).toBe(true);

    // Off: both revert to their defaults for the rest of the drive.
    act(() => result.current.toggleDeveloperOptions());
    expect(result.current.throttleInference).toBe(true);
    expect(result.current.showDebug).toBe(false);

    // Back on: the tweaks come back rather than having been reset.
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
        showDebug: false,
        radarAudio: true,
        throttleInference: true,
        centerCropFrames: false,
      }),
    );
  });
});
