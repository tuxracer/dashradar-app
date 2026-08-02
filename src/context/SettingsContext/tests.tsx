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
import type {
  PersistedSettings,
  SettingsContextValue,
} from "@/context/SettingsContext";

afterEach(() => {
  window.localStorage.clear();
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <SettingsProvider>{children}</SettingsProvider>
);

/** Mounts the provider over `blob`, if any, and hands back the hook result. */
const mount = (blob?: Partial<PersistedSettings> & { zoom2x?: boolean }) => {
  if (blob) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  return renderHook(() => useSettings(), { wrapper });
};

/** The settings field currently persisted to localStorage. */
const stored = <K extends keyof PersistedSettings>(key: K) =>
  JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")[key];

/**
 * Every boolean toggle: the field it owns, its default, and the toggle that
 * flips it. `developer` fields report their off-switch value until the master
 * switch is on, so a test that wants the real one has to turn it on first.
 */
const TOGGLES: ReadonlyArray<{
  key: keyof PersistedSettings & keyof SettingsContextValue;
  toggle: keyof SettingsContextValue;
  fresh: boolean;
  developer: boolean;
}> = [
  {
    key: "showDebug",
    toggle: "toggleShowDebug",
    fresh: false,
    developer: true,
  },
  {
    key: "frameThumbnails",
    toggle: "toggleFrameThumbnails",
    fresh: false,
    developer: true,
  },
  {
    key: "saveFrames",
    toggle: "toggleSaveFrames",
    fresh: false,
    developer: true,
  },
  {
    key: "autoSaveFrames",
    toggle: "toggleAutoSaveFrames",
    fresh: false,
    developer: true,
  },
  {
    key: "zoomIndicator",
    toggle: "toggleZoomIndicator",
    fresh: false,
    developer: true,
  },
  {
    key: "roundTripIndicator",
    toggle: "toggleRoundTripIndicator",
    fresh: false,
    developer: true,
  },
  {
    key: "cameraPreview",
    toggle: "toggleCameraPreview",
    fresh: false,
    developer: true,
  },
  {
    key: "detectionView",
    toggle: "toggleDetectionView",
    fresh: false,
    developer: true,
  },
  {
    key: "rawConfidence",
    toggle: "toggleRawConfidence",
    fresh: false,
    developer: true,
  },
  {
    key: "throttleInference",
    toggle: "toggleThrottleInference",
    fresh: true,
    developer: true,
  },
  {
    key: "radarAudio",
    toggle: "toggleRadarAudio",
    fresh: true,
    developer: false,
  },
  {
    key: "detectionImage",
    toggle: "toggleDetectionImage",
    fresh: false,
    developer: false,
  },
];

describe("SettingsContext", () => {
  it("reports every setting at its fresh-install value out of the box", () => {
    const { result } = mount();
    expect(result.current.developerOptions).toBe(false);
    for (const { key, fresh } of TOGGLES) {
      expect(result.current[key], key).toBe(fresh);
    }
    expect(result.current.zoomMode).toBe("auto");
    expect(result.current.confidenceThreshold).toBe(0.5);
  });

  // Turning the master switch on reveals the developer rows and does nothing
  // else: every one of them stays where it was until someone taps it.
  it("turns nothing on when developerOptions is switched on", () => {
    const { result } = mount();
    act(() => result.current.toggleDeveloperOptions());
    expect(result.current.developerOptions).toBe(true);
    for (const { key, fresh } of TOGGLES) {
      expect(result.current[key], key).toBe(fresh);
    }
    expect(result.current.zoomMode).toBe("auto");
    expect(result.current.confidenceThreshold).toBe(0.5);
  });

  it.each(TOGGLES)("$toggle flips and persists $key alone", (entry) => {
    const { result } = mount();
    act(() => result.current.toggleDeveloperOptions());
    act(() => (result.current[entry.toggle] as () => void)());
    expect(result.current[entry.key]).toBe(!entry.fresh);
    expect(stored(entry.key)).toBe(!entry.fresh);
    for (const other of TOGGLES) {
      if (other.key !== entry.key) {
        expect(stored(other.key), other.key).toBe(other.fresh);
      }
    }
  });

  it("persists the whole settings blob under the current version", () => {
    const { result } = mount();
    act(() => result.current.openSettings());
    // The open state is session-only and must stay out of the stored blob.
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
        detectionView: false,
        rawConfidence: false,
      }),
    );
  });

  it("reports every developer option at its off-switch value while developerOptions is off", () => {
    const { result } = mount({
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
      detectionView: true,
      rawConfidence: true,
      confidenceThreshold: 0.2,
    });
    for (const { key, fresh, developer } of TOGGLES) {
      if (developer) expect(result.current[key], key).toBe(fresh);
    }
    // A fixed-zoom override and a lowered threshold are developer tweaks; a
    // normal drive always runs the defaults.
    expect(result.current.zoomMode).toBe("auto");
    expect(result.current.confidenceThreshold).toBe(0.5);
  });

  // A normal-drive setting, not a developer one: it stays exactly as the driver
  // left it whatever the master switch does.
  it("keeps the driver-facing settings where they were left", () => {
    const { result } = mount({ radarAudio: false, detectionImage: true });
    expect(result.current.developerOptions).toBe(false);
    expect(result.current.radarAudio).toBe(false);
    expect(result.current.detectionImage).toBe(true);
  });

  it("restores the stored developer options when developerOptions comes back on", () => {
    const { result } = mount();
    act(() => result.current.toggleDeveloperOptions());
    act(() => result.current.toggleThrottleInference());
    act(() => result.current.toggleShowDebug());
    act(() => result.current.setZoomMode("1x"));
    act(() => result.current.setConfidenceThreshold(0.3));

    // Off: each reverts to its off-switch value for the rest of the drive,
    // while the stored blob keeps the tweak.
    act(() => result.current.toggleDeveloperOptions());
    expect(result.current.throttleInference).toBe(true);
    expect(result.current.showDebug).toBe(false);
    expect(result.current.zoomMode).toBe("auto");
    expect(result.current.confidenceThreshold).toBe(0.5);
    expect(stored("showDebug")).toBe(true);

    // Back on: the tweaks come back rather than having been reset.
    act(() => result.current.toggleDeveloperOptions());
    expect(result.current.throttleInference).toBe(false);
    expect(result.current.showDebug).toBe(true);
    expect(result.current.zoomMode).toBe("1x");
    expect(result.current.confidenceThreshold).toBe(0.3);
  });

  it("defaults settingsOpen to false and toggles via open/close", () => {
    const { result } = mount();
    expect(result.current.settingsOpen).toBe(false);
    act(() => result.current.openSettings());
    expect(result.current.settingsOpen).toBe(true);
    act(() => result.current.closeSettings());
    expect(result.current.settingsOpen).toBe(false);
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
});

describe("SettingsContext stored blob", () => {
  it("defaults the fields a partial blob leaves out", () => {
    const { result } = mount({ radarAudio: false });
    expect(result.current.radarAudio).toBe(false);
    expect(result.current.throttleInference).toBe(true);
    expect(result.current.detectionImage).toBe(false);
  });

  it("falls back to defaults when stored JSON is corrupt", () => {
    window.localStorage.setItem(STORAGE_KEY, "not json {");
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.radarAudio).toBe(true);
  });

  it("falls back to defaults when a stored field has the wrong type", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ showDebug: 1 }));
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.showDebug).toBe(false);
  });

  it("falls back to the auto mode when a stored zoomMode is invalid", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true, zoomMode: "4x" }),
    );
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.zoomMode).toBe("auto");
  });

  it("snaps a corrupt stored confidence to a valid level", () => {
    const { result } = mount({
      developerOptions: true,
      confidenceThreshold: 5,
    });
    expect(CONFIDENCE_LEVELS).toContain(result.current.confidenceThreshold);
  });
});

describe("SettingsContext migrations", () => {
  it("migrates a legacy stored zoom2x true to the 2x mode", () => {
    const { result } = mount({ developerOptions: true, zoom2x: true });
    expect(result.current.zoomMode).toBe("2x");
  });

  it("ignores a legacy stored zoom2x false", () => {
    const { result } = mount({ developerOptions: true, zoom2x: false });
    expect(result.current.zoomMode).toBe("auto");
  });

  it("prefers a stored zoomMode over a lingering legacy zoom2x", () => {
    const { result } = mount({
      developerOptions: true,
      zoom2x: true,
      zoomMode: "1x",
    });
    expect(result.current.zoomMode).toBe("1x");
  });

  // A blob from before the developer options stopped defaulting on stores the
  // five display options as true whether or not anyone chose them, so it is
  // migrated to off on load.
  it("turns off the developer options a pre-version blob defaulted on", () => {
    const { result } = mount({
      developerOptions: true,
      showDebug: true,
      frameThumbnails: true,
      saveFrames: true,
      zoomIndicator: true,
      roundTripIndicator: true,
    });
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
    const { result } = mount({
      developerOptions: true,
      autoSaveFrames: true,
      cameraPreview: true,
      throttleInference: false,
      zoomMode: "1x",
      confidenceThreshold: 0.2,
      radarAudio: false,
      detectionImage: true,
    });
    expect(result.current.autoSaveFrames).toBe(true);
    expect(result.current.cameraPreview).toBe(true);
    expect(result.current.throttleInference).toBe(false);
    expect(result.current.zoomMode).toBe("1x");
    expect(result.current.confidenceThreshold).toBe(0.2);
    expect(result.current.radarAudio).toBe(false);
    expect(result.current.detectionImage).toBe(true);
  });

  it("does not re-run the migration over a choice made after it", () => {
    const first = mount({ developerOptions: true, showDebug: true });
    expect(first.result.current.showDebug).toBe(false);
    act(() => first.result.current.toggleShowDebug());
    first.unmount();

    const second = renderHook(() => useSettings(), { wrapper });
    expect(second.result.current.showDebug).toBe(true);
  });

  it("tolerates a current-version blob predating a later option", () => {
    const { result } = mount({
      settingsVersion: SETTINGS_VERSION,
      developerOptions: true,
      showDebug: true,
    });
    expect(result.current.showDebug).toBe(true);
    expect(result.current.frameThumbnails).toBe(false);
    expect(result.current.saveFrames).toBe(false);
    expect(result.current.autoSaveFrames).toBe(false);
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

  it("snaps an off-step value handed to setConfidenceThreshold", () => {
    const { result } = mount();
    act(() => result.current.toggleDeveloperOptions());
    act(() => result.current.setConfidenceThreshold(0.27));
    expect(result.current.confidenceThreshold).toBe(0.3);
    expect(stored("confidenceThreshold")).toBe(0.3);
  });
});
