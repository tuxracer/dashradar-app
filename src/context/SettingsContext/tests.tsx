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
  it("defaults showVideo to true when storage is empty", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.showVideo).toBe(true);
  });

  it("toggling flips showVideo and persists it to localStorage", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => result.current.toggleShowVideo());
    expect(result.current.showVideo).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        showVideo: false,
        showDebug: false,
        stabilizeMotion: false,
      }),
    );
  });

  it("restores the persisted value on a fresh mount", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showVideo: false }),
    );
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.showVideo).toBe(false);
  });

  it("falls back to defaults when stored JSON is corrupt", () => {
    window.localStorage.setItem(STORAGE_KEY, "not json {");
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.showVideo).toBe(true);
  });

  it("falls back to defaults when stored shape is wrong", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ showVideo: 1 }));
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.showVideo).toBe(true);
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
        showVideo: true,
        showDebug: false,
        stabilizeMotion: false,
      }),
    );
  });

  it("defaults showDebug to false when storage is empty", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.showDebug).toBe(false);
  });

  it("toggling flips showDebug and persists it to localStorage", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => result.current.toggleShowDebug());
    expect(result.current.showDebug).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        showVideo: true,
        showDebug: true,
        stabilizeMotion: false,
      }),
    );
  });

  it("defaults stabilizeMotion to false when storage is empty", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.stabilizeMotion).toBe(false);
  });

  it("toggling flips stabilizeMotion and persists it to localStorage", () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => result.current.toggleStabilizeMotion());
    expect(result.current.stabilizeMotion).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        showVideo: true,
        showDebug: false,
        stabilizeMotion: true,
      }),
    );
  });

  it("keeps showVideo when loading a pre-showDebug stored blob", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showVideo: false }),
    );
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.showVideo).toBe(false);
    expect(result.current.showDebug).toBe(false);
  });
});
