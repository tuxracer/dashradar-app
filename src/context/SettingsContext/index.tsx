import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { DEFAULT_SETTINGS, STORAGE_KEY } from "./consts";
import type { Settings, SettingsContextValue } from "./types";
import { isPersistedSettings } from "./types";

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
    return isPersistedSettings(parsed)
      ? { ...DEFAULT_SETTINGS, ...parsed }
      : DEFAULT_SETTINGS;
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
  const [showDebug, setShowDebug] = useState(() => loadSettings().showDebug);
  const [radarAudio, setRadarAudio] = useState(() => loadSettings().radarAudio);
  const [throttleInference, setThrottleInference] = useState(
    () => loadSettings().throttleInference,
  );

  useEffect(() => {
    const next: Settings = { showDebug, radarAudio, throttleInference };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable (private mode / quota); keep the in-memory value.
    }
  }, [showDebug, radarAudio, throttleInference]);

  const toggleShowDebug = useCallback(() => {
    setShowDebug((prev) => !prev);
  }, []);

  const toggleRadarAudio = useCallback(() => {
    setRadarAudio((prev) => !prev);
  }, []);

  const toggleThrottleInference = useCallback(() => {
    setThrottleInference((prev) => !prev);
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
      showDebug,
      toggleShowDebug,
      radarAudio,
      toggleRadarAudio,
      throttleInference,
      toggleThrottleInference,
      settingsOpen,
      openSettings,
      closeSettings,
    }),
    [
      showDebug,
      toggleShowDebug,
      radarAudio,
      toggleRadarAudio,
      throttleInference,
      toggleThrottleInference,
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
