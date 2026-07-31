import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { track } from "@vercel/analytics";
import {
  CameraPermissionScreen,
  markCameraPromptAccepted,
  shouldShowCameraPrompt,
} from "@/components/CameraPermissionScreen";
import { CameraPreview } from "@/components/CameraPreview";
import { CameraView } from "@/components/CameraView";
import { DebugOverlay } from "@/components/DebugOverlay";
import { DevVideoView } from "@/components/DevVideoView";
import { ErrorScreen } from "@/components/ErrorScreen";
import {
  IntroScreen,
  markIntroSeen,
  shouldShowIntro,
} from "@/components/IntroScreen";
import { ModelLoadScreen } from "@/components/ModelLoadScreen";
import { RadarBackdrop } from "@/components/RadarBackdrop";
import { RadarDetectorScreen } from "@/components/RadarDetectorScreen";
import { RoundTripIndicator } from "@/components/RoundTripIndicator";
import { SaveToast } from "@/components/SaveToast";
import { SettingsScreen } from "@/components/SettingsScreen";
import { StatusBar } from "@/components/StatusBar";
import { VideoDropTarget } from "@/components/VideoDropTarget";
import { ZoomIndicator } from "@/components/ZoomIndicator";
import { DetectionProvider, useDetection } from "@/context/DetectionContext";
import { DevVideoProvider, useDevVideo } from "@/context/DevVideoContext";
import { SettingsProvider, useSettings } from "@/context/SettingsContext";
import type { CameraError } from "@/lib/camera";
import type { Size } from "@/lib/detection";
import { hudScore, hudSignal } from "@/lib/radarSignal";
import { createWakeLockManager } from "@/lib/wakeLock";
import { ZOOM_2X, ZOOM_OFF } from "@/workers/detection/consts";

const useViewportSize = (): Size => {
  const [size, setSize] = useState<Size>({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  useEffect(() => {
    const handleResize = () => {
      setSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  return size;
};

const RadarScreen = () => {
  const {
    status,
    backend,
    backendProbe,
    mainThreadWebGpu,
    downloadingModel,
    modelProgress,
    hud,
    contact,
    savedFrame,
    autoZoom,
    getDebugSnapshot,
    error,
    start,
    cameraStalled,
    cameraEpoch,
    clearCameraStall,
    swapVideoSource,
  } = useDetection();
  const {
    radarAudio,
    frameThumbnails,
    saveFrames,
    zoomMode,
    zoomIndicator,
    roundTripIndicator,
    cameraPreview,
    rawConfidence,
  } = useSettings();
  const { source } = useDevVideo();
  // A video file feed has no camera to introduce or ask permission for, so the
  // intro is skipped outright and the radar view loads immediately.
  const [showIntro, setShowIntro] = useState(
    () => source === null && shouldShowIntro(),
  );
  // The in-app permission ask sits between the intro and the first
  // getUserMedia call, so the browser's own prompt never lands unexplained.
  // A video file feed never requests the camera, so it skips the ask too.
  const [showCameraPrompt, setShowCameraPrompt] = useState(
    () => source === null && shouldShowCameraPrompt(),
  );
  const [cameraPromptDeclined, setCameraPromptDeclined] = useState(false);
  const [cameraError, setCameraError] = useState<CameraError>();
  const [videoSize, setVideoSize] = useState<Size>();
  // The camera's video element, kept so the developer camera preview can play
  // the same MediaStream. Refreshed on every stream (re)start, including the
  // remount a cameraEpoch bump forces.
  const [cameraVideo, setCameraVideo] = useState<HTMLVideoElement>();
  const viewportSize = useViewportSize();
  const wakeLock = useMemo(() => createWakeLockManager(), []);

  useEffect(() => {
    if (status === "running") {
      void wakeLock.acquire();
      return () => {
        void wakeLock.release();
      };
    }
  }, [status, wakeLock]);

  // Report a camera failure to analytics once when it occurs. Detection-side
  // failures (model load, worker crash) are tracked at their source in
  // DetectionContext; camera errors only surface here, where getUserMedia's
  // result reaches the UI. Camera permission-denied rate is the app's most
  // valuable funnel signal, and with no backend this is the only view into it.
  useEffect(() => {
    if (cameraError) {
      track("error", { code: cameraError.code });
    }
  }, [cameraError]);

  const updateVideoSize = useCallback((video: HTMLVideoElement) => {
    setVideoSize({ width: video.videoWidth, height: video.videoHeight });
  }, []);

  const handleStream = useCallback(
    (video: HTMLVideoElement) => {
      updateVideoSize(video);
      setCameraVideo(video);
      start(video);
    },
    [start, updateVideoSize],
  );

  // A file the browser cannot decode presents no frames at all, so the feed
  // goes back to whatever the session started with (the camera, or the
  // DASHRADAR_VIDEO clip). Leaving it in place would park the pump on a frame
  // callback that never fires, with the stall watchdog disabled for a file
  // feed, and the meter would read SCANNING for the rest of the drive.
  const handleDevVideoError = useCallback(() => {
    swapVideoSource(null);
  }, [swapVideoSource]);

  // Returning to the camera gives it a clean slate: a permission error or a
  // stall recorded before the clip was loaded must not pre-empt the fresh
  // getUserMedia call the remounting CameraView is about to make. Those two
  // are the only screens a clip must not restore, which is why they reset here
  // while every other camera screen is merely outranked by a source. The ref
  // narrows this to the clip-to-camera edge, so a session that never played a
  // clip is untouched.
  const clipPlayedRef = useRef(false);
  useEffect(() => {
    if (source) {
      clipPlayedRef.current = true;
      return;
    }
    if (!clipPlayedRef.current) {
      return;
    }
    clipPlayedRef.current = false;
    setCameraError(undefined);
    clearCameraStall();
  }, [source, clearCameraStall]);

  if (showIntro && !source) {
    return (
      <IntroScreen
        onStart={() => {
          track("intro_start");
          markIntroSeen();
          setShowIntro(false);
        }}
      />
    );
  }
  // Declining the in-app permission ask lands on the same screen as a real
  // browser-level denial; its reload button restarts the flow at the ask.
  if (cameraPromptDeclined && !source) {
    return <ErrorScreen code="PERMISSION_DENIED" />;
  }
  if (showCameraPrompt && !source) {
    return (
      <CameraPermissionScreen
        onAllow={() => {
          track("camera_prompt_allow");
          markCameraPromptAccepted();
          setShowCameraPrompt(false);
        }}
        onDecline={() => {
          track("camera_prompt_decline");
          setCameraPromptDeclined(true);
        }}
      />
    );
  }
  if (cameraError && !source) {
    return <ErrorScreen code={cameraError.code} />;
  }
  if (status === "error" && error) {
    return <ErrorScreen code={error} />;
  }
  // Automatic camera recovery gave up on a frozen or black feed: ask the driver
  // to clear the lens and reload rather than looping silent remounts/reloads.
  if (cameraStalled && !source) {
    return <ErrorScreen code="CAMERA_STALLED" />;
  }

  // The camera feed stays mounted but invisible while the model loads, so
  // getUserMedia fires right after the intro's START tap.
  const modelLoading = status === "loading-model";

  return (
    <main className="fixed inset-0 bg-surface">
      <RadarBackdrop />
      {source ? (
        <DevVideoView
          key={source.url}
          src={source.url}
          scanning={status === "running"}
          onStream={handleStream}
          onVideoResize={updateVideoSize}
          onError={handleDevVideoError}
        />
      ) : (
        <CameraView
          key={cameraEpoch}
          onStream={handleStream}
          onError={setCameraError}
          onVideoResize={updateVideoSize}
        />
      )}
      {/* The meter mounts immediately so the first paint past the permission
          flow is the instrument reading INITIALIZING, not a blank backdrop;
          the sweep starts once detection is running. A first-visit download
          is still covered by the opaque ModelLoadScreen below. */}
      <RadarDetectorScreen
        confidence={hudSignal(hud)}
        audioEnabled={radarAudio}
        contact={contact}
        frameThumbnails={frameThumbnails}
        saveFrames={saveFrames}
        initializing={status !== "running"}
        rawConfidence={rawConfidence ? hudScore(hud) : undefined}
      />

      {/* The zoom mirrors sendFrame's mapping, so the preview always narrows
          to the region the next capture actually scans. Mounted in dev video
          mode too: the corner player shows the whole clip, the preview the
          crop. */}
      {!modelLoading && cameraPreview && cameraVideo && (
        <CameraPreview
          source={cameraVideo}
          zoom={
            zoomMode === "2x"
              ? ZOOM_2X
              : zoomMode === "auto"
                ? autoZoom.zoom
                : ZOOM_OFF
          }
        />
      )}
      <SaveToast saved={savedFrame} />
      <StatusBar
        center={
          zoomIndicator || roundTripIndicator ? (
            <span className="flex items-center gap-2">
              {zoomIndicator && (
                <ZoomIndicator
                  mode={zoomMode}
                  level={autoZoom.zoom}
                  locked={autoZoom.locked}
                />
              )}
              {roundTripIndicator && (
                <RoundTripIndicator getDebug={getDebugSnapshot} />
              )}
            </span>
          ) : undefined
        }
      />
      <DebugOverlay
        backend={backend}
        backendProbe={backendProbe}
        mainThreadWebGpu={mainThreadWebGpu}
        modelProgress={modelProgress}
        getDebug={getDebugSnapshot}
        videoSize={videoSize}
        viewportSize={viewportSize}
      />
      <SettingsScreen />
      {status === "loading-model" && downloadingModel && (
        <ModelLoadScreen progress={modelProgress} />
      )}
    </main>
  );
};

const App = () => {
  return (
    <SettingsProvider>
      {/* DevVideoProvider wraps DetectionProvider, which consumes it: outside
          the provider the hook falls back to a value whose setters are no-ops,
          so the wrong nesting would make every feed swap silently do nothing. */}
      <DevVideoProvider>
        <DetectionProvider>
          <VideoDropTarget />
          <RadarScreen />
        </DetectionProvider>
      </DevVideoProvider>
    </SettingsProvider>
  );
};

export default App;
