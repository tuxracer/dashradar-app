import { useEffect, useRef, useState } from "react";
import { track } from "@vercel/analytics";
import { ChevronRight, X } from "lucide-react";
import { ModelScreen } from "@/components/ModelScreen";
import { ShareCard } from "@/components/ShareCard";
import { useSettings } from "@/context/SettingsContext";
import { useVideoSource } from "@/context/VideoSourceContext";
import { resolveModels } from "@/lib/detectionModels";
import { resetAppData } from "@/lib/resetAppData";
import { SCENE_FOV_DEG_MAX, SCENE_FOV_DEG_MIN } from "@/lib/scenePlacement";
import { REPO_URL, RESET_CONFIRM_MESSAGE, ZOOM_MODE_OPTIONS } from "./consts";

export * from "./consts";

/** The pill switch used by every toggle row. `on` drives the track and knob. */
const Toggle = ({ on }: { on: boolean }) => (
  <span
    className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors ${
      on ? "bg-hud-amber" : "bg-white/25"
    }`}
  >
    <span
      className={`inline-block h-6 w-6 rounded-full bg-surface transition-transform ${
        on ? "translate-x-[1.75rem]" : "translate-x-[0.25rem]"
      }`}
    />
  </span>
);

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
  // Sent before the clearing pass rather than after it: the reload can cut an
  // in-flight request, so the pass (deleting the ~54 MB weights among the rest)
  // is the widest window this event will get. It is also the only signal that
  // separates a fresh install from a wiped one, which otherwise look
  // identical in the funnel.
  track("reset");
  void resetAppData().finally(() => window.location.reload());
};

/**
 * Full-screen settings panel built for driver-first use on a dash mount, in
 * landscape. Renders nothing until the panel is opened. Large, full-width rows
 * with big tap targets: the Audio alerts and Detection image toggles, the
 * Detection model row, the Developer options toggle, the development-only
 * controls it reveals (Debug overlay, Zoom indicator, Round-trip, Raw
 * confidence, Camera preview, Detection view, Throttle inference, Skip still
 * frames, the segmented Zoom mode picker, Min confidence, Scene FoV, Video
 * file, Reset app data), plus the About row.
 * Detection model is the one row that leads somewhere: it opens ModelScreen in
 * place of this panel, which owns picking the model and applying the choice.
 * Closes on the large close button or Escape, and Escape backs out of the model
 * screen first rather than dismissing both. While it is open the detection
 * pump is paused (DetectionContext watches `settingsOpen`) and resumes on
 * close.
 */
export const SettingsScreen = () => {
  const {
    settingsOpen,
    closeSettings,
    developerOptions,
    toggleDeveloperOptions,
    showDebug,
    toggleShowDebug,
    radarAudio,
    toggleRadarAudio,
    detectionImage,
    toggleDetectionImage,
    throttleInference,
    toggleThrottleInference,
    sceneChangeGate,
    toggleSceneChangeGate,
    zoomMode,
    setZoomMode,
    modelIds,
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
  } = useSettings();
  const { source, setVideoFile, clearVideoFile } = useVideoSource();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [modelScreenOpen, setModelScreenOpen] = useState(false);

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      // Backs out one screen at a time rather than dismissing both at once,
      // which is what a sub-screen makes someone expect and is also what keeps
      // modelScreenOpen from outliving the panel. This component is rendered
      // unconditionally and only returns null while the panel is closed, so it
      // never unmounts: closing settings straight from the sub-screen would
      // leave modelScreenOpen true and reopen settings onto the picker.
      if (modelScreenOpen) {
        setModelScreenOpen(false);
        return;
      }
      closeSettings();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [settingsOpen, closeSettings, modelScreenOpen]);

  if (!settingsOpen) {
    return null;
  }

  // Rendered instead of the panel rather than over it, so there is one screen
  // on the glass at a time. settingsOpen stays true throughout, which is what
  // keeps the detection pump paused while a model is being picked.
  if (modelScreenOpen) {
    return <ModelScreen onClose={() => setModelScreenOpen(false)} />;
  }

  const versionLabel = __COMMIT_SHA__;

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-surface/95 backdrop-blur-md">
      <div className="flex items-center justify-between px-6 pb-4 pt-[max(1.5rem,env(safe-area-inset-top))]">
        <span className="text-base font-semibold tracking-[0.34em] text-white/85">
          SETTINGS
        </span>
        <button
          type="button"
          onClick={closeSettings}
          className="flex h-12 w-12 items-center justify-center rounded-full text-white/70 transition-colors hover:text-white/90"
        >
          <X className="h-7 w-7" strokeWidth={2} />
          <span className="sr-only">Close settings</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex w-full max-w-2xl flex-col divide-y divide-white/10">
          <button
            type="button"
            onClick={toggleRadarAudio}
            className="flex min-h-16 items-center justify-between gap-6 py-4 text-left"
          >
            <span className="flex flex-col gap-1">
              <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
                Audio alerts
              </span>
              <span className="text-sm font-medium text-white/45">
                Beeps faster as the signal climbs.
              </span>
            </span>
            <Toggle on={radarAudio} />
          </button>

          <button
            type="button"
            onClick={toggleDetectionImage}
            className="flex min-h-16 items-center justify-between gap-6 py-4 text-left"
          >
            <span className="flex flex-col gap-1">
              <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
                Detection image
              </span>
              <span className="text-sm font-medium text-white/45">
                Shows a picture of what was detected.
              </span>
            </span>
            <Toggle on={detectionImage} />
          </button>

          <button
            type="button"
            data-testid="open-model-screen"
            onClick={() => setModelScreenOpen(true)}
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
            <span className="flex items-center gap-2 text-base font-semibold tracking-[0.04em] text-white/60">
              {resolveModels(modelIds)
                .map((model) => model.slug)
                .join(", ")}
              <ChevronRight className="h-5 w-5 shrink-0" strokeWidth={2} />
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              // Switching off takes a picked clip back to the camera with it.
              // The row holding the only CLEAR button is inside the block
              // below, so a clip left running here would strand the session on
              // canned footage with a reload as the way out.
              if (developerOptions && source) {
                clearVideoFile();
              }
              toggleDeveloperOptions();
            }}
            className="flex min-h-16 items-center justify-between gap-6 py-4 text-left"
          >
            <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
              Developer options
            </span>
            <Toggle on={developerOptions} />
          </button>

          {developerOptions && (
            <>
              <button
                type="button"
                onClick={toggleShowDebug}
                className="flex min-h-16 items-center justify-between gap-6 py-4 text-left"
              >
                <span className="flex flex-col gap-1">
                  <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
                    Debug overlay
                  </span>
                  <span className="text-sm font-medium text-white/45">
                    Shows timing and detection diagnostics.
                  </span>
                </span>
                <Toggle on={showDebug} />
              </button>

              <button
                type="button"
                onClick={toggleZoomIndicator}
                className="flex min-h-16 items-center justify-between gap-6 py-4 text-left"
              >
                <span className="flex flex-col gap-1">
                  <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
                    Zoom indicator
                  </span>
                  <span className="text-sm font-medium text-white/45">
                    Shows the active zoom in the status bar.
                  </span>
                </span>
                <Toggle on={zoomIndicator} />
              </button>

              <button
                type="button"
                onClick={toggleRoundTripIndicator}
                className="flex min-h-16 items-center justify-between gap-6 py-4 text-left"
              >
                <span className="flex flex-col gap-1">
                  <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
                    Round-trip
                  </span>
                  <span className="text-sm font-medium text-white/45">
                    Shows the last scan time in the status bar.
                  </span>
                </span>
                <Toggle on={roundTripIndicator} />
              </button>

              <button
                type="button"
                onClick={toggleRawConfidence}
                className="flex min-h-16 items-center justify-between gap-6 py-4 text-left"
              >
                <span className="flex flex-col gap-1">
                  <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
                    Raw confidence
                  </span>
                  <span className="text-sm font-medium text-white/45">
                    Shows the model score in the dial readout.
                  </span>
                </span>
                <Toggle on={rawConfidence} />
              </button>

              <button
                type="button"
                onClick={toggleCameraPreview}
                className="flex min-h-16 items-center justify-between gap-6 py-4 text-left"
              >
                <span className="flex flex-col gap-1">
                  <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
                    Camera preview
                  </span>
                  <span className="text-sm font-medium text-white/45">
                    Shows the live feed being scanned.
                  </span>
                </span>
                <Toggle on={cameraPreview} />
              </button>

              <button
                type="button"
                onClick={toggleDetectionView}
                className="flex min-h-16 items-center justify-between gap-6 py-4 text-left"
              >
                <span className="flex flex-col gap-1">
                  <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
                    Detection view
                  </span>
                  <span className="text-sm font-medium text-white/45">
                    Shows the camera feed with detection boxes.
                  </span>
                </span>
                <Toggle on={detectionView} />
              </button>

              <button
                type="button"
                onClick={toggleThrottleInference}
                className="flex min-h-16 items-center justify-between gap-6 py-4 text-left"
              >
                <span className="flex flex-col gap-1">
                  <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
                    Throttle inference
                  </span>
                  <span className="text-sm font-medium text-white/45">
                    Paces detection to limit heat and battery.
                  </span>
                </span>
                <Toggle on={throttleInference} />
              </button>

              <button
                type="button"
                onClick={toggleSceneChangeGate}
                className="flex min-h-16 items-center justify-between gap-6 py-4 text-left"
              >
                <span className="flex flex-col gap-1">
                  <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
                    Skip still frames
                  </span>
                  <span className="text-sm font-medium text-white/45">
                    Saves inference while the view holds steady.
                  </span>
                </span>
                <Toggle on={sceneChangeGate} />
              </button>

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
                    onChange={(event) =>
                      setSceneFov(Number(event.target.value))
                    }
                    aria-label="Scene FoV"
                    className="h-3 w-full cursor-pointer appearance-none rounded-full bg-white/20 accent-hud-amber"
                  />
                  <span className="text-sm font-medium text-white/45">
                    Calibrates scene distances to the camera lens.
                  </span>
                </span>
              </div>

              {/* Sits with the developer rows, and so does the drop gesture it
                  mirrors: this row holds the only way back to the camera, so a
                  clip that could arrive with the master switch off would have
                  no way out. */}
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
                    // Clear the input so picking the same file twice still
                    // fires change.
                    event.target.value = "";
                  }}
                />
              </div>

              {/* Only the button fires, never the whole row: every other row
                  here is a full-width tap target, and this one deletes the
                  install. */}
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
            </>
          )}

          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-16 items-center justify-between gap-6 py-4"
          >
            <span className="flex flex-col gap-1">
              <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
                About
              </span>
              <span className="text-sm font-medium text-white/45">
                No images leave the device.
              </span>
            </span>
            <span className="text-base font-semibold tracking-[0.12em] text-white/60">
              {versionLabel} ↗
            </span>
          </a>

          <ShareCard />
        </div>
      </div>
    </div>
  );
};
