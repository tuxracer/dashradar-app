import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { DEFAULT_SETTINGS, DEVELOPER_OPTIONS_OFF, STORAGE_KEY } from "./consts";
import type { Settings, SettingsContextValue } from "./types";
import { isPersistedSettings, snapConfidence } from "./types";

export * from "./consts";
export * from "./types";

/** React context for managing app settings. */
const SettingsContext = createContext<SettingsContextValue | undefined>(
  undefined,
);

/** Hook to access settings and controls from SettingsProvider. */
export const useSettings = (): SettingsContextValue => {
  const value = useContext(SettingsContext);
  if (!value) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return value;
};

/**
 * Reads and validates settings from localStorage, falling back to defaults when
 * storage is empty, corrupt, or unavailable (private mode / quota). A valid but
 * partial blob (for example one stored before showDebug existed) is merged over
 * DEFAULT_SETTINGS, so missing fields take their default instead of resetting
 * everything.
 */
const loadSettings = (): Settings => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isPersistedSettings(parsed)) {
      return DEFAULT_SETTINGS;
    }
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    return {
      ...merged,
      confidenceThreshold: snapConfidence(merged.confidenceThreshold),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

/** Props for SettingsProvider component. */
type SettingsProviderProps = {
  children: ReactNode;
};

/** Provider component for settings state management and persistence. */
export const SettingsProvider = ({ children }: SettingsProviderProps) => {
  const [developerOptions, setDeveloperOptions] = useState(
    () => loadSettings().developerOptions,
  );
  const [storedShowDebug, setShowDebug] = useState(
    () => loadSettings().showDebug,
  );
  const [radarAudio, setRadarAudio] = useState(() => loadSettings().radarAudio);
  const [storedThrottleInference, setThrottleInference] = useState(
    () => loadSettings().throttleInference,
  );
  const [storedCenterCropFrames, setCenterCropFrames] = useState(
    () => loadSettings().centerCropFrames,
  );
  const [storedConfidenceThreshold, setStoredConfidenceThreshold] = useState(
    () => loadSettings().confidenceThreshold,
  );

  // The four developer options report their DEVELOPER_OPTIONS_OFF value
  // whenever developerOptions is off, so a tweak left enabled (the debug
  // overlay, unthrottled inference, squished frames, a lowered confidence
  // floor) stops taking effect the moment the master switch goes off. The
  // stored value is untouched, so turning it back on restores the tweak.
  const showDebug = developerOptions
    ? storedShowDebug
    : DEVELOPER_OPTIONS_OFF.showDebug;
  const throttleInference = developerOptions
    ? storedThrottleInference
    : DEVELOPER_OPTIONS_OFF.throttleInference;
  const centerCropFrames = developerOptions
    ? storedCenterCropFrames
    : DEVELOPER_OPTIONS_OFF.centerCropFrames;
  const confidenceThreshold = developerOptions
    ? storedConfidenceThreshold
    : DEVELOPER_OPTIONS_OFF.confidenceThreshold;

  useEffect(() => {
    const next: Settings = {
      developerOptions,
      showDebug: storedShowDebug,
      radarAudio,
      throttleInference: storedThrottleInference,
      centerCropFrames: storedCenterCropFrames,
      confidenceThreshold: storedConfidenceThreshold,
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable (private mode / quota); keep the in-memory value.
    }
  }, [
    developerOptions,
    storedShowDebug,
    radarAudio,
    storedThrottleInference,
    storedCenterCropFrames,
    storedConfidenceThreshold,
  ]);

  const toggleDeveloperOptions = useCallback(() => {
    setDeveloperOptions((prev) => !prev);
  }, []);

  const toggleShowDebug = useCallback(() => {
    setShowDebug((prev) => !prev);
  }, []);

  const toggleRadarAudio = useCallback(() => {
    setRadarAudio((prev) => !prev);
  }, []);

  const toggleThrottleInference = useCallback(() => {
    setThrottleInference((prev) => !prev);
  }, []);

  const toggleCenterCropFrames = useCallback(() => {
    setCenterCropFrames((prev) => !prev);
  }, []);

  const setConfidenceThreshold = useCallback((level: number) => {
    setStoredConfidenceThreshold(snapConfidence(level));
  }, []);

  const [settingsOpen, setSettingsOpen] = useState(false);

  const openSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  const value = useMemo(
    () => ({
      developerOptions,
      toggleDeveloperOptions,
      showDebug,
      toggleShowDebug,
      radarAudio,
      toggleRadarAudio,
      throttleInference,
      toggleThrottleInference,
      centerCropFrames,
      toggleCenterCropFrames,
      confidenceThreshold,
      setConfidenceThreshold,
      settingsOpen,
      openSettings,
      closeSettings,
    }),
    [
      developerOptions,
      toggleDeveloperOptions,
      showDebug,
      toggleShowDebug,
      radarAudio,
      toggleRadarAudio,
      throttleInference,
      toggleThrottleInference,
      centerCropFrames,
      toggleCenterCropFrames,
      confidenceThreshold,
      setConfidenceThreshold,
      settingsOpen,
      openSettings,
      closeSettings,
    ],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
};
