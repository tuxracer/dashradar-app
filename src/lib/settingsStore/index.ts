import { isPlainObject } from "remeda";
import {
  DEFAULT_SETTINGS,
  DEVELOPER_OPTIONS_OFF,
  SETTINGS_VERSION,
  STORAGE_KEY,
} from "./consts";
import type {
  BooleanSettingKey,
  PersistedSettings,
  Settings,
  SettingsSnapshot,
  SettingsStore,
} from "./types";
import { isPersistedSettings, snapConfidence, snapSceneFov } from "./types";

export * from "./consts";
export * from "./types";

/**
 * Turns off the developer options that used to default on: the debug overlay
 * and the two status pills. A blob written before SETTINGS_VERSION 1 stores
 * those as true whether or not anyone asked for them, because they were the
 * defaults, so turning Developer options on would light them up on a device
 * that never chose any of them. The other developer options are left alone:
 * they already defaulted to their off value, so a stored value there could
 * only have come from someone setting it.
 */
const clearLegacyDefaultOnOptions = (settings: Settings): Settings => ({
  ...settings,
  showDebug: DEVELOPER_OPTIONS_OFF.showDebug,
  zoomIndicator: DEVELOPER_OPTIONS_OFF.zoomIndicator,
  roundTripIndicator: DEVELOPER_OPTIONS_OFF.roundTripIndicator,
});

/**
 * Reads and validates settings from localStorage, falling back to defaults
 * when storage is empty, corrupt, or unavailable (private mode / quota). A
 * valid but partial blob (for example one stored before showDebug existed) is
 * merged over DEFAULT_SETTINGS, so missing fields take their default instead
 * of resetting everything. A blob older than SETTINGS_VERSION runs through
 * the migration above before anything reads it; the write-back on store
 * creation stamps the current version, so that happens exactly once.
 */
export const loadSettings = (): Settings => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }
    const rawParsed: unknown = JSON.parse(raw);
    // Migrate the retired "auto" zoom mode (every pre-removal blob stores it,
    // since it was the default) to the plain 1x scan before validation, so it
    // reads as the new default instead of invalidating the whole blob.
    const parsed: unknown =
      isPlainObject(rawParsed) && rawParsed.zoomMode === "auto"
        ? { ...rawParsed, zoomMode: "1x" }
        : rawParsed;
    // Migrate the legacy zoom2x boolean (which zoomMode replaced): a stored
    // true carries over as the 2x mode so the tweak survives the rename. Read
    // off the raw blob, since zoom2x is no longer part of the Settings shape.
    const legacyZoom2x = isPlainObject(parsed) && parsed.zoom2x === true;
    if (!isPersistedSettings(parsed)) {
      return DEFAULT_SETTINGS;
    }
    const { settingsVersion, ...stored } = parsed;
    const zoomMode =
      stored.zoomMode ?? (legacyZoom2x ? "2x" : DEFAULT_SETTINGS.zoomMode);
    const merged = { ...DEFAULT_SETTINGS, ...stored, zoomMode };
    const settings: Settings = {
      ...merged,
      confidenceThreshold: snapConfidence(merged.confidenceThreshold),
      sceneFov: snapSceneFov(merged.sceneFov),
    };
    return (settingsVersion ?? 0) < SETTINGS_VERSION
      ? clearLegacyDefaultOnOptions(settings)
      : settings;
  } catch {
    return DEFAULT_SETTINGS;
  }
};

/**
 * Persists a settings blob, reporting whether the write landed. Storage can
 * be unavailable (private mode) or full, and the callers want different
 * things from that: ordinary updates keep the in-memory value and move on,
 * while a commit that is about to reload the page has to know it failed.
 */
const writeSettings = (next: PersistedSettings): boolean => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
};

/**
 * Builds the settings store for one page load. Loads once, writes the blob
 * straight back (stamping the current schema version, which is what makes a
 * migration run exactly once), and persists synchronously on every change.
 * The write-back is idempotent, so a discarded StrictMode duplicate store
 * rewrites the same bytes and costs nothing.
 */
export const createSettingsStore = (): SettingsStore => {
  let stored = loadSettings();
  let settingsOpen = false;
  const listeners = new Set<() => void>();

  const buildSnapshot = (): SettingsSnapshot => ({
    // The developer options report their DEVELOPER_OPTIONS_OFF values while
    // the master switch is off, so a tweak left enabled stops taking effect
    // the moment it goes off; the stored value underneath is untouched.
    ...(stored.developerOptions
      ? {
          showDebug: stored.showDebug,
          throttleInference: stored.throttleInference,
          sceneChangeGate: stored.sceneChangeGate,
          zoomMode: stored.zoomMode,
          confidenceThreshold: stored.confidenceThreshold,
          sceneFov: stored.sceneFov,
          modelIds: stored.modelIds,
          zoomIndicator: stored.zoomIndicator,
          roundTripIndicator: stored.roundTripIndicator,
          cameraPreview: stored.cameraPreview,
          detectionView: stored.detectionView,
          rawConfidence: stored.rawConfidence,
        }
      : DEVELOPER_OPTIONS_OFF),
    developerOptions: stored.developerOptions,
    radarAudio: stored.radarAudio,
    viewMode: stored.viewMode,
    detectionImage: stored.detectionImage,
    settingsOpen,
  });

  let snapshot = buildSnapshot();
  const notify = () => {
    snapshot = buildSnapshot();
    for (const listener of [...listeners]) {
      listener();
    }
  };
  const persisted = (): PersistedSettings => ({
    settingsVersion: SETTINGS_VERSION,
    ...stored,
  });
  const update = (patch: Partial<Settings>) => {
    stored = { ...stored, ...patch };
    // Persist failure is tolerated for ordinary updates: the in-memory value
    // keeps working for the session even when storage refuses the write.
    writeSettings(persisted());
    notify();
  };

  writeSettings(persisted());

  return {
    getSnapshot: () => snapshot,
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    toggle: (key: BooleanSettingKey) => {
      update({ [key]: !stored[key] });
    },
    setZoomMode: (mode) => {
      update({ zoomMode: mode });
    },
    setViewMode: (mode) => {
      update({ viewMode: mode });
    },
    setConfidenceThreshold: (level) => {
      update({ confidenceThreshold: snapConfidence(level) });
    },
    setSceneFov: (deg) => {
      update({ sceneFov: snapSceneFov(deg) });
    },
    commitModelIds: (ids) => {
      const wrote = writeSettings({ ...persisted(), modelIds: ids });
      if (wrote) {
        stored = { ...stored, modelIds: ids };
        notify();
      }
      return wrote;
    },
    setSettingsOpen: (open) => {
      settingsOpen = open;
      notify();
    },
  };
};
