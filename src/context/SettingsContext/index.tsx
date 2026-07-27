import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { isPlainObject } from "remeda";
import { DEFAULT_SETTINGS, DEVELOPER_OPTIONS_OFF, STORAGE_KEY } from "./consts";
import type { Settings, SettingsContextValue, ZoomMode } from "./types";
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
    // Migrate the legacy zoom2x boolean (which zoomMode replaced): a stored
    // true carries over as the 2x mode so the tweak survives the rename. Read
    // off the raw blob, since zoom2x is no longer part of the Settings shape.
    const legacyZoom2x = isPlainObject(parsed) && parsed.zoom2x === true;
    if (!isPersistedSettings(parsed)) {
      return DEFAULT_SETTINGS;
    }
    const zoomMode =
      parsed.zoomMode ?? (legacyZoom2x ? "2x" : DEFAULT_SETTINGS.zoomMode);
    const merged = { ...DEFAULT_SETTINGS, ...parsed, zoomMode };
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
  const [storedFrameThumbnails, setFrameThumbnails] = useState(
    () => loadSettings().frameThumbnails,
  );
  const [storedSaveFrames, setSaveFrames] = useState(
    () => loadSettings().saveFrames,
  );
  const [storedAutoSaveFrames, setAutoSaveFrames] = useState(
    () => loadSettings().autoSaveFrames,
  );
  const [radarAudio, setRadarAudio] = useState(() => loadSettings().radarAudio);
  const [storedThrottleInference, setThrottleInference] = useState(
    () => loadSettings().throttleInference,
  );
  const [storedZoomMode, setStoredZoomMode] = useState(
    () => loadSettings().zoomMode,
  );
  const [storedConfidenceThreshold, setStoredConfidenceThreshold] = useState(
    () => loadSettings().confidenceThreshold,
  );
  const [storedZoomIndicator, setZoomIndicator] = useState(
    () => loadSettings().zoomIndicator,
  );
  const [storedRoundTripIndicator, setRoundTripIndicator] = useState(
    () => loadSettings().roundTripIndicator,
  );
  const [storedCameraPreview, setCameraPreview] = useState(
    () => loadSettings().cameraPreview,
  );

  // The developer options report their DEVELOPER_OPTIONS_OFF value whenever
  // developerOptions is off, so a tweak left enabled (the debug overlay, the
  // per-scan frame preview, the live camera preview, frame saving, unthrottled
  // inference, a zoomed-in crop, a lowered confidence floor) stops taking effect
  // the moment the master switch goes off. The stored value is untouched, so
  // turning it back on restores the tweak.
  const showDebug = developerOptions
    ? storedShowDebug
    : DEVELOPER_OPTIONS_OFF.showDebug;
  const frameThumbnails = developerOptions
    ? storedFrameThumbnails
    : DEVELOPER_OPTIONS_OFF.frameThumbnails;
  const saveFrames = developerOptions
    ? storedSaveFrames
    : DEVELOPER_OPTIONS_OFF.saveFrames;
  const autoSaveFrames = developerOptions
    ? storedAutoSaveFrames
    : DEVELOPER_OPTIONS_OFF.autoSaveFrames;
  const throttleInference = developerOptions
    ? storedThrottleInference
    : DEVELOPER_OPTIONS_OFF.throttleInference;
  const zoomMode = developerOptions
    ? storedZoomMode
    : DEVELOPER_OPTIONS_OFF.zoomMode;
  const confidenceThreshold = developerOptions
    ? storedConfidenceThreshold
    : DEVELOPER_OPTIONS_OFF.confidenceThreshold;
  const zoomIndicator = developerOptions
    ? storedZoomIndicator
    : DEVELOPER_OPTIONS_OFF.zoomIndicator;
  const roundTripIndicator = developerOptions
    ? storedRoundTripIndicator
    : DEVELOPER_OPTIONS_OFF.roundTripIndicator;
  const cameraPreview = developerOptions
    ? storedCameraPreview
    : DEVELOPER_OPTIONS_OFF.cameraPreview;

  useEffect(() => {
    const next: Settings = {
      developerOptions,
      showDebug: storedShowDebug,
      frameThumbnails: storedFrameThumbnails,
      saveFrames: storedSaveFrames,
      autoSaveFrames: storedAutoSaveFrames,
      radarAudio,
      throttleInference: storedThrottleInference,
      zoomMode: storedZoomMode,
      confidenceThreshold: storedConfidenceThreshold,
      zoomIndicator: storedZoomIndicator,
      roundTripIndicator: storedRoundTripIndicator,
      cameraPreview: storedCameraPreview,
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable (private mode / quota); keep the in-memory value.
    }
  }, [
    developerOptions,
    storedShowDebug,
    storedFrameThumbnails,
    storedSaveFrames,
    storedAutoSaveFrames,
    radarAudio,
    storedThrottleInference,
    storedZoomMode,
    storedConfidenceThreshold,
    storedZoomIndicator,
    storedRoundTripIndicator,
    storedCameraPreview,
  ]);

  const toggleDeveloperOptions = useCallback(() => {
    setDeveloperOptions((prev) => !prev);
  }, []);

  const toggleShowDebug = useCallback(() => {
    setShowDebug((prev) => !prev);
  }, []);

  const toggleFrameThumbnails = useCallback(() => {
    setFrameThumbnails((prev) => !prev);
  }, []);

  const toggleSaveFrames = useCallback(() => {
    setSaveFrames((prev) => !prev);
  }, []);

  const toggleAutoSaveFrames = useCallback(() => {
    setAutoSaveFrames((prev) => !prev);
  }, []);

  const toggleRadarAudio = useCallback(() => {
    setRadarAudio((prev) => !prev);
  }, []);

  const toggleThrottleInference = useCallback(() => {
    setThrottleInference((prev) => !prev);
  }, []);

  const setZoomMode = useCallback((mode: ZoomMode) => {
    setStoredZoomMode(mode);
  }, []);

  const setConfidenceThreshold = useCallback((level: number) => {
    setStoredConfidenceThreshold(snapConfidence(level));
  }, []);

  const toggleZoomIndicator = useCallback(() => {
    setZoomIndicator((prev) => !prev);
  }, []);

  const toggleRoundTripIndicator = useCallback(() => {
    setRoundTripIndicator((prev) => !prev);
  }, []);

  const toggleCameraPreview = useCallback(() => {
    setCameraPreview((prev) => !prev);
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
      frameThumbnails,
      toggleFrameThumbnails,
      saveFrames,
      toggleSaveFrames,
      autoSaveFrames,
      toggleAutoSaveFrames,
      radarAudio,
      toggleRadarAudio,
      throttleInference,
      toggleThrottleInference,
      zoomMode,
      setZoomMode,
      confidenceThreshold,
      setConfidenceThreshold,
      zoomIndicator,
      toggleZoomIndicator,
      roundTripIndicator,
      toggleRoundTripIndicator,
      cameraPreview,
      toggleCameraPreview,
      settingsOpen,
      openSettings,
      closeSettings,
    }),
    [
      developerOptions,
      toggleDeveloperOptions,
      showDebug,
      toggleShowDebug,
      frameThumbnails,
      toggleFrameThumbnails,
      saveFrames,
      toggleSaveFrames,
      autoSaveFrames,
      toggleAutoSaveFrames,
      radarAudio,
      toggleRadarAudio,
      throttleInference,
      toggleThrottleInference,
      zoomMode,
      setZoomMode,
      confidenceThreshold,
      setConfidenceThreshold,
      zoomIndicator,
      toggleZoomIndicator,
      roundTripIndicator,
      toggleRoundTripIndicator,
      cameraPreview,
      toggleCameraPreview,
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
