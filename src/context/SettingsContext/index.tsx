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
 * storage is empty, corrupt, or unavailable (private mode / quota).
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
  const [showVideo, setShowVideo] = useState(() => loadSettings().showVideo);
  const [showDebug, setShowDebug] = useState(() => loadSettings().showDebug);

  useEffect(() => {
    const next: Settings = { showVideo, showDebug };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable (private mode / quota); keep the in-memory value.
    }
  }, [showVideo, showDebug]);

  const toggleShowVideo = useCallback(() => {
    setShowVideo((prev) => !prev);
  }, []);

  const toggleShowDebug = useCallback(() => {
    setShowDebug((prev) => !prev);
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
      showVideo,
      toggleShowVideo,
      showDebug,
      toggleShowDebug,
      settingsOpen,
      openSettings,
      closeSettings,
    }),
    [
      showVideo,
      toggleShowVideo,
      showDebug,
      toggleShowDebug,
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
