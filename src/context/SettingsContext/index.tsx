import {
  createContext,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { createSettingsStore } from "@/lib/settingsStore";
import type { SettingsContextValue } from "./types";

export * from "./consts";
export * from "./types";

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

type SettingsProviderProps = {
  children: ReactNode;
};

/**
 * Thin React adapter over the settings store (src/lib/settingsStore), which
 * owns loading, migrations, persistence, and the developer-options gating.
 * This provider mirrors the store's snapshots into React and binds the named
 * actions the screens call.
 */
export const SettingsProvider = ({ children }: SettingsProviderProps) => {
  const [store] = useState(createSettingsStore);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  const value = useMemo<SettingsContextValue>(
    () => ({
      ...snapshot,
      toggleDeveloperOptions: () => store.toggle("developerOptions"),
      toggleShowDebug: () => store.toggle("showDebug"),
      toggleRadarAudio: () => store.toggle("radarAudio"),
      toggleDetectionImage: () => store.toggle("detectionImage"),
      toggleThrottleInference: () => store.toggle("throttleInference"),
      toggleSceneChangeGate: () => store.toggle("sceneChangeGate"),
      setZoomMode: store.setZoomMode,
      setViewMode: (mode) => store.setViewMode(mode),
      commitModelIds: store.commitModelIds,
      setConfidenceThreshold: store.setConfidenceThreshold,
      setSceneFov: (deg) => store.setSceneFov(deg),
      toggleZoomIndicator: () => store.toggle("zoomIndicator"),
      toggleRoundTripIndicator: () => store.toggle("roundTripIndicator"),
      toggleConsoleDiagnostics: () => store.toggle("consoleDiagnostics"),
      toggleCameraPreview: () => store.toggle("cameraPreview"),
      toggleDetectionView: () => store.toggle("detectionView"),
      toggleRawConfidence: () => store.toggle("rawConfidence"),
      openSettings: () => store.setSettingsOpen(true),
      closeSettings: () => store.setSettingsOpen(false),
    }),
    [snapshot, store],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
};
