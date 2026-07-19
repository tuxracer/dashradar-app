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

const SettingsContext = createContext<SettingsContextValue | undefined>(
  undefined,
);

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
    return isPersistedSettings(parsed) ? parsed : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
};

type SettingsProviderProps = {
  children: ReactNode;
};

export const SettingsProvider = ({ children }: SettingsProviderProps) => {
  const [showVideo, setShowVideo] = useState(() => loadSettings().showVideo);

  useEffect(() => {
    const next: Settings = { showVideo };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable (private mode / quota); keep the in-memory value.
    }
  }, [showVideo]);

  const toggleShowVideo = useCallback(() => {
    setShowVideo((prev) => !prev);
  }, []);

  const value = useMemo(
    () => ({ showVideo, toggleShowVideo }),
    [showVideo, toggleShowVideo],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
};
