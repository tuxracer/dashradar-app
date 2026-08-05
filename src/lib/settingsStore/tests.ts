import { afterEach, describe, expect, it } from "vitest";
import {
  SCENE_FOV_DEG_DEFAULT,
  SCENE_FOV_DEG_MAX,
  SCENE_FOV_DEG_MIN,
} from "@/lib/scenePlacement";
import {
  createSettingsStore,
  SETTINGS_VERSION,
  snapSceneFov,
  STORAGE_KEY,
} from "@/lib/settingsStore";

afterEach(() => {
  window.localStorage.clear();
});

/** Seeds localStorage with `blob`, if any, and builds a fresh store over it. */
const mountStore = (blob?: object) => {
  if (blob) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  return createSettingsStore();
};

describe("snapSceneFov", () => {
  it("resolves a non-finite value to the default lens", () => {
    expect(snapSceneFov(NaN)).toBe(SCENE_FOV_DEG_DEFAULT);
    expect(snapSceneFov(Infinity)).toBe(SCENE_FOV_DEG_DEFAULT);
    expect(snapSceneFov(-Infinity)).toBe(SCENE_FOV_DEG_DEFAULT);
  });

  it("rounds to a whole degree", () => {
    expect(snapSceneFov(67.4)).toBe(67);
    expect(snapSceneFov(67.6)).toBe(68);
  });

  it("clamps an out-of-range value to the nearest end", () => {
    expect(snapSceneFov(200)).toBe(SCENE_FOV_DEG_MAX);
    expect(snapSceneFov(10)).toBe(SCENE_FOV_DEG_MIN);
  });

  it("snaps the value handed to setSceneFov", () => {
    const store = mountStore({ developerOptions: true });
    store.setSceneFov(72.6);
    expect(store.getSnapshot().sceneFov).toBe(73);
  });
});

describe("scene FoV gating", () => {
  it("reports the default lens while developer options are off", () => {
    const store = mountStore({ developerOptions: false, sceneFov: 80 });
    expect(store.getSnapshot().sceneFov).toBe(SCENE_FOV_DEG_DEFAULT);
  });

  it("reports the stored lens once developer options are on", () => {
    const store = mountStore({ developerOptions: true, sceneFov: 80 });
    expect(store.getSnapshot().sceneFov).toBe(80);
  });
});

describe("view mode", () => {
  it("persists a scene selection and reloads into it", () => {
    const first = mountStore();
    expect(first.getSnapshot().viewMode).toBe("radar");
    first.setViewMode("scene");
    expect(first.getSnapshot().viewMode).toBe("scene");

    const second = createSettingsStore();
    expect(second.getSnapshot().viewMode).toBe("scene");
  });

  it("falls back to defaults when a stored viewMode is invalid", () => {
    const store = mountStore({ viewMode: "hologram", radarAudio: false });
    expect(store.getSnapshot().viewMode).toBe("radar");
    // The guard rejects the whole blob, so every field is back at default.
    expect(store.getSnapshot().radarAudio).toBe(true);
  });

  it("defaults a blob predating both fields without rejecting it", () => {
    const store = mountStore({
      settingsVersion: SETTINGS_VERSION,
      developerOptions: true,
      radarAudio: false,
    });
    expect(store.getSnapshot().viewMode).toBe("radar");
    expect(store.getSnapshot().sceneFov).toBe(SCENE_FOV_DEG_DEFAULT);
    expect(store.getSnapshot().radarAudio).toBe(false);
  });
});

describe("validating a stored blob", () => {
  it("rejects a blob whose field is the wrong type", () => {
    // A value of the wrong shape reaching a consumer is worse than losing the
    // stored tweaks, so a bad field takes the whole blob down to defaults
    // rather than being merged in and read as settings.
    const store = mountStore({
      settingsVersion: SETTINGS_VERSION,
      radarAudio: "yes",
      detectionImage: true,
    });
    expect(store.getSnapshot().radarAudio).toBe(true);
    expect(store.getSnapshot().detectionImage).toBe(false);
  });

  it("rejects a modelIds list holding anything but strings", () => {
    const store = mountStore({
      settingsVersion: SETTINGS_VERSION,
      developerOptions: true,
      modelIds: ["fine", 7],
    });
    expect(store.getSnapshot().developerOptions).toBe(false);
  });

  it("keeps a blob carrying a key this build does not know", () => {
    // A blob written by a newer build, or by one that has since dropped a
    // setting, still has to load: the fields both builds share are good.
    const store = mountStore({
      settingsVersion: SETTINGS_VERSION,
      radarAudio: false,
      settingFromTheFuture: { nested: true },
    });
    expect(store.getSnapshot().radarAudio).toBe(false);
  });
});
