import { act, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONFIDENCE_LEVELS,
  DEVELOPER_OPTIONS_OFF,
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
import { DEFAULT_MODEL } from "@/lib/detectionModels";

afterEach(() => {
  window.localStorage.clear();
  // A test that spies on Storage.prototype and fails before its own restore
  // would otherwise leave a throwing setItem behind for every later test here.
  vi.restoreAllMocks();
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <SettingsProvider>{children}</SettingsProvider>
);

/** Mounts the provider over `blob`, if any, and hands back the hook result. */
const mount = (
  blob?: Omit<Partial<PersistedSettings>, "zoomMode"> & {
    zoom2x?: boolean;
    zoomMode?: string;
  },
) => {
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
    expect(result.current.zoomMode).toBe("1x");
    expect(result.current.confidenceThreshold).toBe(
      DEVELOPER_OPTIONS_OFF.confidenceThreshold,
    );
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
    expect(result.current.zoomMode).toBe("1x");
    expect(result.current.confidenceThreshold).toBe(
      DEVELOPER_OPTIONS_OFF.confidenceThreshold,
    );
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
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null"),
    ).toEqual({
      settingsVersion: SETTINGS_VERSION,
      developerOptions: false,
      showDebug: false,
      radarAudio: true,
      viewMode: "radar",
      detectionImage: false,
      throttleInference: true,
      sceneChangeGate: true,
      zoomMode: "1x",
      confidenceThreshold: DEVELOPER_OPTIONS_OFF.confidenceThreshold,
      sceneFov: DEVELOPER_OPTIONS_OFF.sceneFov,
      modelIds: [DEFAULT_MODEL.id],
      zoomIndicator: false,
      roundTripIndicator: false,
      cameraPreview: false,
      detectionView: false,
      rawConfidence: false,
    });
  });

  it("reports every developer option at its off-switch value while developerOptions is off", () => {
    const { result } = mount({
      developerOptions: false,
      showDebug: true,
      throttleInference: false,
      zoomMode: "2x",
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
    expect(result.current.zoomMode).toBe("1x");
    expect(result.current.confidenceThreshold).toBe(
      DEVELOPER_OPTIONS_OFF.confidenceThreshold,
    );
  });

  // A normal-drive setting, not a developer one: it stays exactly as the driver
  // left it whatever the master switch does.
  it("keeps the driver-facing settings where they were left", () => {
    const { result } = mount({ radarAudio: false, detectionImage: true });
    expect(result.current.developerOptions).toBe(false);
    expect(result.current.radarAudio).toBe(false);
    expect(result.current.detectionImage).toBe(true);
  });

  // Driver-facing like radarAudio: the status-bar button is its only control,
  // so it works with the master switch off.
  it("setViewMode flips and persists the main view", () => {
    const { result } = mount();
    expect(result.current.viewMode).toBe("radar");
    act(() => result.current.setViewMode("scene"));
    expect(result.current.viewMode).toBe("scene");
    expect(stored("viewMode")).toBe("scene");
  });

  it("snaps an off-degree value handed to setSceneFov", () => {
    const { result } = mount();
    act(() => result.current.toggleDeveloperOptions());
    act(() => result.current.setSceneFov(72.6));
    expect(result.current.sceneFov).toBe(73);
    expect(stored("sceneFov")).toBe(73);
  });

  it("restores the stored developer options when developerOptions comes back on", () => {
    const { result } = mount();
    act(() => result.current.toggleDeveloperOptions());
    act(() => result.current.toggleThrottleInference());
    act(() => result.current.toggleShowDebug());
    act(() => result.current.setZoomMode("2x"));
    act(() => result.current.setConfidenceThreshold(0.3));

    // Off: each reverts to its off-switch value for the rest of the drive,
    // while the stored blob keeps the tweak.
    act(() => result.current.toggleDeveloperOptions());
    expect(result.current.throttleInference).toBe(true);
    expect(result.current.showDebug).toBe(false);
    expect(result.current.zoomMode).toBe("1x");
    expect(result.current.confidenceThreshold).toBe(
      DEVELOPER_OPTIONS_OFF.confidenceThreshold,
    );
    expect(stored("showDebug")).toBe(true);

    // Back on: the tweaks come back rather than having been reset.
    act(() => result.current.toggleDeveloperOptions());
    expect(result.current.throttleInference).toBe(false);
    expect(result.current.showDebug).toBe(true);
    expect(result.current.zoomMode).toBe("2x");
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

  it("falls back to the 1x mode when a stored zoomMode is invalid", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true, zoomMode: "4x" }),
    );
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.zoomMode).toBe("1x");
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
    expect(result.current.zoomMode).toBe("1x");
  });

  it("prefers a stored zoomMode over a lingering legacy zoom2x", () => {
    const { result } = mount({
      developerOptions: true,
      zoom2x: true,
      zoomMode: "1x",
    });
    expect(result.current.zoomMode).toBe("1x");
  });

  // Every blob from before the auto mode was retired stores zoomMode "auto"
  // (it was the default), so it must read as 1x rather than invalidating the
  // whole blob and resetting every other setting with it.
  it("migrates a stored auto zoom mode to 1x without resetting the blob", () => {
    const { result } = mount({
      developerOptions: true,
      zoomMode: "auto",
      radarAudio: false,
    });
    expect(result.current.zoomMode).toBe("1x");
    expect(result.current.radarAudio).toBe(false);
  });

  // A blob from before the developer options stopped defaulting on stores the
  // display options as true whether or not anyone chose them, so it is
  // migrated to off on load.
  it("turns off the developer options a pre-version blob defaulted on", () => {
    const { result } = mount({
      developerOptions: true,
      showDebug: true,
      zoomIndicator: true,
      roundTripIndicator: true,
    });
    expect(result.current.developerOptions).toBe(true);
    expect(result.current.showDebug).toBe(false);
    expect(result.current.zoomIndicator).toBe(false);
    expect(result.current.roundTripIndicator).toBe(false);
  });

  it("keeps the deliberate options a pre-version blob stored", () => {
    // None of these could be there by default, so each one is a choice someone
    // made and the migration leaves it alone.
    const { result } = mount({
      developerOptions: true,
      cameraPreview: true,
      throttleInference: false,
      zoomMode: "2x",
      confidenceThreshold: 0.2,
      radarAudio: false,
      detectionImage: true,
    });
    expect(result.current.cameraPreview).toBe(true);
    expect(result.current.throttleInference).toBe(false);
    expect(result.current.zoomMode).toBe("2x");
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
    expect(result.current.cameraPreview).toBe(false);
    expect(result.current.detectionView).toBe(false);
  });
});

describe("model selection", () => {
  it("starts on the shipping model", () => {
    const { result } = mount();
    expect(result.current.modelIds).toEqual([DEFAULT_MODEL.id]);
  });

  // Driver-facing, not a developer option: the Detection model row is what says
  // which checkpoint is running, so a selection that stopped applying with the
  // master switch off would leave the row naming a model the app is not using.
  it("reports the stored selection whatever the master switch does", () => {
    expect(
      mount({ developerOptions: false, modelIds: ["other"] }).result.current
        .modelIds,
    ).toEqual(["other"]);
    expect(
      mount({ developerOptions: true, modelIds: ["other"] }).result.current
        .modelIds,
    ).toEqual(["other"]);
  });

  it("ignores a stored selection that is not a list of strings", () => {
    const { result } = mount({
      modelIds: [7],
    } as unknown as Partial<PersistedSettings>);
    expect(result.current.modelIds).toEqual([DEFAULT_MODEL.id]);
  });

  it("commits the selection without waiting for an effect", () => {
    const { result } = mount();
    // Deliberately not wrapped in act(): the commit has to reach storage on its
    // own, because the caller reloads the page on the next line and would
    // outrun the persist effect.
    expect(result.current.commitModelIds(["other"])).toBe(true);
    expect(stored("modelIds")).toEqual(["other"]);
  });

  it("keeps the rest of the settings when it commits", () => {
    const { result } = mount({ developerOptions: true, radarAudio: false });
    result.current.commitModelIds(["other"]);
    expect(stored("radarAudio")).toBe(false);
    expect(stored("developerOptions")).toBe(true);
  });

  it("reports a commit that storage refused", () => {
    const { result } = mount({ developerOptions: true });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(result.current.commitModelIds(["other"])).toBe(false);
  });
});

describe("snapConfidence", () => {
  it("resolves a non-finite value to the production floor", () => {
    const floor = DEVELOPER_OPTIONS_OFF.confidenceThreshold;
    expect(snapConfidence(NaN)).toBe(floor);
    expect(snapConfidence(Infinity)).toBe(floor);
    expect(snapConfidence(-Infinity)).toBe(floor);
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
