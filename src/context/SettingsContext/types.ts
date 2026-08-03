import type { SettingsSnapshot, ZoomMode } from "@/lib/settingsStore";

/**
 * The settings domain types live with the store (src/lib/settingsStore);
 * these re-exports keep the context module the one import consumers need.
 */
export type {
  DeveloperOptions,
  PersistedSettings,
  Settings,
  SettingsSnapshot,
  ZoomMode,
} from "@/lib/settingsStore";
export {
  isPersistedSettings,
  isZoomMode,
  snapConfidence,
} from "@/lib/settingsStore";

/**
 * Value exposed via useSettings(): the store's published snapshot (developer
 * options already gated to their effective values) plus the named actions the
 * screens call.
 */
export type SettingsContextValue = SettingsSnapshot & {
  toggleDeveloperOptions: () => void;
  toggleShowDebug: () => void;
  toggleRadarAudio: () => void;
  toggleDetectionImage: () => void;
  toggleThrottleInference: () => void;
  /** Sets the zoom mode (1x or 2x). */
  setZoomMode: (mode: ZoomMode) => void;
  /**
   * Writes a model selection straight to localStorage and reports whether the
   * write landed. Deliberately synchronous: the caller reloads the page
   * immediately afterwards to apply the change. A false return means storage
   * refused the write (private mode, quota), so the caller must not reload.
   */
  commitModelIds: (ids: readonly string[]) => boolean;
  /** Sets the minimum-confidence level, snapping to the nearest allowed step. */
  setConfidenceThreshold: (level: number) => void;
  toggleZoomIndicator: () => void;
  toggleRoundTripIndicator: () => void;
  toggleCameraPreview: () => void;
  toggleDetectionView: () => void;
  toggleRawConfidence: () => void;
  /** Opens the full-screen settings panel. */
  openSettings: () => void;
  /** Closes the full-screen settings panel. */
  closeSettings: () => void;
};
