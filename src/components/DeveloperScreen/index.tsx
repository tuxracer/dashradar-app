import { useRef } from "react";
import type { ReactNode } from "react";
import { track } from "@vercel/analytics";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ToggleRow } from "@/components/ToggleRow";
import { useSettings } from "@/context/SettingsContext";
import { useVideoSource } from "@/context/VideoSourceContext";
import { resetAppData } from "@/lib/resetAppData";
import { SCENE_FOV_DEG_MAX, SCENE_FOV_DEG_MIN } from "@/lib/scenePlacement";
import {
  RESET_CONFIRM_MESSAGE,
  ROW_ENTER_STAGGER_MS,
  ZOOM_MODE_OPTIONS,
} from "./consts";

export * from "./consts";

/**
 * Wipes every client-side store behind a confirm, then reloads whatever
 * happened: resetAppData reports that the clearing pass ran, not that every
 * store was writable, and a launch on partially cleared state is still closer
 * to first run than staying on this one.
 */
const handleReset = () => {
  if (!window.confirm(RESET_CONFIRM_MESSAGE)) {
    return;
  }
  // Before the clearing pass rather than after: the reload can cut an in-flight
  // request, so the pass is the widest window this event gets. It is also the
  // only thing separating a fresh install from a wiped one in the funnel.
  track("reset");
  void resetAppData().finally(() => window.location.reload());
};

/** Props for DeveloperScreen. */
type DeveloperScreenProps = {
  /** Returns to the settings panel. */
  onClose: () => void;
  /**
   * Opens the model picker. Owned by the settings panel rather than by this
   * screen, so backing out of the picker lands here instead of dismissing both
   * and so one component keeps the whole screen stack.
   */
  onOpenModel: () => void;
};

/**
 * Full-screen home for the developer options. Nothing here is meant for someone
 * driving, so the rows use this codebase's words rather than the plain ones the
 * driver-facing panel is held to.
 *
 * The master switch is the top row and hides everything else, so the screen says
 * what it is before it says what it can do. It is the same flag the settings
 * store gates on, so flipping it off does not merely hide the rows below, they
 * stop applying. Detection model is the exception, ungated because the picker
 * confirms and reloads and that choice must outlive the switch.
 */
export const DeveloperScreen = ({
  onClose,
  onOpenModel,
}: DeveloperScreenProps) => {
  const {
    developerOptions,
    toggleDeveloperOptions,
    showDebug,
    toggleShowDebug,
    throttleInference,
    toggleThrottleInference,
    sceneChangeGate,
    toggleSceneChangeGate,
    zoomMode,
    setZoomMode,
    confidenceThreshold,
    setConfidenceThreshold,
    sceneFov,
    setSceneFov,
    zoomIndicator,
    toggleZoomIndicator,
    roundTripIndicator,
    toggleRoundTripIndicator,
    cameraPreview,
    toggleCameraPreview,
    detectionView,
    toggleDetectionView,
    rawConfidence,
    toggleRawConfidence,
    consoleDiagnostics,
    toggleConsoleDiagnostics,
  } = useSettings();
  const { source, setVideoFile, clearVideoFile } = useVideoSource();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Built as a list so each row carries its own entrance delay without the
  // numbering being written out by hand. Flipping the master switch is the tap
  // this stagger answers.
  const rows: readonly { key: string; row: ReactNode }[] = [
    {
      key: "model",
      row: (
        <button
          type="button"
          data-testid="open-model-screen"
          onClick={onOpenModel}
          className="flex min-h-16 items-center justify-between gap-6 py-4 text-left"
        >
          <span className="flex flex-col gap-1">
            <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
              Detection model
            </span>
            <span className="text-sm font-medium text-white/45">
              Sets what the app looks for on the road.
            </span>
          </span>
          {/* No model name here. A checkpoint's name is a repo slug, far too
              long for what is left of a row, and it wrapped over two lines to
              say something the screen behind this row says properly. */}
          <ChevronRight
            className="h-5 w-5 shrink-0 text-white/60"
            strokeWidth={2}
          />
        </button>
      ),
    },
    {
      key: "showDebug",
      row: (
        <ToggleRow
          label="Debug overlay"
          description="Shows timing and detection diagnostics."
          on={showDebug}
          onToggle={toggleShowDebug}
        />
      ),
    },
    {
      key: "consoleDiagnostics",
      row: (
        <ToggleRow
          label="Console diagnostics"
          description="Mirrors the detection log to the browser console."
          on={consoleDiagnostics}
          onToggle={toggleConsoleDiagnostics}
        />
      ),
    },
    {
      key: "zoomIndicator",
      row: (
        <ToggleRow
          label="Zoom indicator"
          description="Shows the active zoom in the status bar."
          on={zoomIndicator}
          onToggle={toggleZoomIndicator}
        />
      ),
    },
    {
      key: "roundTripIndicator",
      row: (
        <ToggleRow
          label="Round-trip"
          description="Shows the last scan time in the status bar."
          on={roundTripIndicator}
          onToggle={toggleRoundTripIndicator}
        />
      ),
    },
    {
      key: "rawConfidence",
      row: (
        <ToggleRow
          label="Raw confidence"
          description="Shows the model score in the dial readout."
          on={rawConfidence}
          onToggle={toggleRawConfidence}
        />
      ),
    },
    {
      key: "cameraPreview",
      row: (
        <ToggleRow
          label="Camera preview"
          description="Shows the live feed being scanned."
          on={cameraPreview}
          onToggle={toggleCameraPreview}
        />
      ),
    },
    {
      key: "detectionView",
      row: (
        <ToggleRow
          label="Detection view"
          description="Shows the camera feed with detection boxes."
          on={detectionView}
          onToggle={toggleDetectionView}
        />
      ),
    },
    {
      key: "throttleInference",
      row: (
        <ToggleRow
          label="Throttle inference"
          description="Paces detection to limit heat and battery."
          on={throttleInference}
          onToggle={toggleThrottleInference}
        />
      ),
    },
    {
      key: "sceneChangeGate",
      row: (
        <ToggleRow
          label="Skip still frames"
          description="Saves inference while the view holds steady."
          on={sceneChangeGate}
          onToggle={toggleSceneChangeGate}
        />
      ),
    },
    {
      key: "zoomMode",
      row: (
        <div className="flex min-h-16 flex-col gap-3 py-4">
          <span className="flex flex-col gap-1">
            <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
              Zoom
            </span>
            <span className="text-sm font-medium text-white/45">
              Sets how far down the road the scan reaches.
            </span>
          </span>
          <div className="flex gap-2">
            {ZOOM_MODE_OPTIONS.map(({ mode, label }) => (
              <button
                key={mode}
                type="button"
                onClick={() => setZoomMode(mode)}
                className={`h-14 flex-1 rounded-xl text-base font-semibold tracking-[0.12em] transition-colors ${
                  zoomMode === mode
                    ? "bg-hud-amber text-surface"
                    : "bg-white/10 text-white/70"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ),
    },
    {
      key: "confidenceThreshold",
      row: (
        <div className="flex min-h-16 items-center py-4">
          <span className="flex flex-1 flex-col gap-2">
            <span className="flex items-center justify-between gap-6">
              <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
                Min confidence
              </span>
              <span className="text-base font-semibold tabular-nums tracking-[0.12em] text-white/60">
                {confidenceThreshold.toFixed(1)}
              </span>
            </span>
            <input
              type="range"
              min={0.1}
              max={0.9}
              step={0.1}
              value={confidenceThreshold}
              onChange={(event) =>
                setConfidenceThreshold(Number(event.target.value))
              }
              aria-label="Min confidence"
              className="h-3 w-full cursor-pointer appearance-none rounded-full bg-white/20 accent-hud-amber"
            />
            <span className="text-sm font-medium text-white/45">
              Lowers the bar for what counts as a detection.
            </span>
          </span>
        </div>
      ),
    },
    {
      key: "sceneFov",
      row: (
        <div className="flex min-h-16 items-center py-4">
          <span className="flex flex-1 flex-col gap-2">
            <span className="flex items-center justify-between gap-6">
              <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
                Scene FoV
              </span>
              <span className="text-base font-semibold tabular-nums tracking-[0.12em] text-white/60">
                {`${sceneFov}°`}
              </span>
            </span>
            <input
              type="range"
              min={SCENE_FOV_DEG_MIN}
              max={SCENE_FOV_DEG_MAX}
              step={1}
              value={sceneFov}
              onChange={(event) => setSceneFov(Number(event.target.value))}
              aria-label="Scene FoV"
              className="h-3 w-full cursor-pointer appearance-none rounded-full bg-white/20 accent-hud-amber"
            />
            <span className="text-sm font-medium text-white/45">
              Calibrates scene distances to the camera lens.
            </span>
          </span>
        </div>
      ),
    },
    {
      key: "videoFile",
      // Sits with the developer rows, and so does the drop gesture it mirrors:
      // this row holds the only way back to the camera, so a clip that could
      // arrive with the master switch off would have no way out.
      row: (
        <div className="flex min-h-16 items-center justify-between gap-6 py-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-1 flex-col gap-1 text-left"
          >
            <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
              Video file
            </span>
            <span className="text-sm font-medium text-white/45">
              Scans a local video instead of the camera.
            </span>
          </button>
          <span className="flex items-center gap-4">
            <span
              data-testid="video-file-value"
              className="max-w-40 truncate text-sm font-medium text-white/70"
            >
              {source ? source.name : "Camera"}
            </span>
            {source && (
              <button
                type="button"
                onClick={clearVideoFile}
                className="min-h-12 shrink-0 rounded-lg border border-white/25 px-4 text-sm font-semibold tracking-[0.06em] text-white/90"
              >
                CLEAR
              </button>
            )}
          </span>
          <input
            ref={fileInputRef}
            data-testid="video-file-input"
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                setVideoFile(file);
              }
              // Clear the input so picking the same file twice still fires
              // change.
              event.target.value = "";
            }}
          />
        </div>
      ),
    },
    {
      key: "reset",
      // Only the button fires, never the whole row: every other row here is a
      // full-width tap target, and this one deletes the install.
      row: (
        <div className="flex min-h-16 items-center justify-between gap-6 py-4">
          <span className="flex flex-col gap-1">
            <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
              Reset app data
            </span>
            <span className="text-sm font-medium text-white/45">
              Erases storage and caches, then reloads.
            </span>
          </span>
          <button
            type="button"
            onClick={handleReset}
            className="min-h-12 shrink-0 rounded-lg border border-white/25 px-4 text-sm font-semibold tracking-[0.06em] text-white/90"
          >
            RESET
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface">
      <div className="flex animate-rise-in items-center gap-6 px-6 pb-4 pt-[max(1.5rem,env(safe-area-inset-top))] motion-reduce:animate-none">
        <button
          type="button"
          data-testid="developer-back"
          onClick={onClose}
          className="flex min-h-14 items-center gap-1 rounded-xl border border-white/25 pl-4 pr-6 text-base font-semibold tracking-[0.12em] text-white/90 transition active:scale-[0.97] motion-reduce:transition-none"
        >
          <ChevronLeft className="h-5 w-5 shrink-0" strokeWidth={2} />
          BACK
        </button>
        <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
          Developer options
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex w-full max-w-2xl flex-col divide-y divide-white/10">
          <ToggleRow
            label="Enable developer options"
            on={developerOptions}
            onToggle={() => {
              // Switching off takes a picked clip back to the camera with it.
              // The row holding the only CLEAR button is one of the ones about
              // to disappear, so a clip left running would strand the session
              // on canned footage with a reload as the way out.
              if (developerOptions && source) {
                clearVideoFile();
              }
              toggleDeveloperOptions();
            }}
          />

          {developerOptions &&
            rows.map(({ key, row }, index) => (
              <div
                key={key}
                style={{
                  animationDelay: `${(index + 1) * ROW_ENTER_STAGGER_MS}ms`,
                }}
                className="flex animate-rise-in flex-col motion-reduce:animate-none"
              >
                {row}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
};
