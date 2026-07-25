import { useCallback, useEffect, useMemo, useState } from "react";
import { track } from "@vercel/analytics";
import {
  CameraPermissionScreen,
  markCameraPromptAccepted,
  shouldShowCameraPrompt,
} from "@/components/CameraPermissionScreen";
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
import { SettingsScreen } from "@/components/SettingsScreen";
import { StatusBar } from "@/components/StatusBar";
import { ZoomIndicator } from "@/components/ZoomIndicator";
import { DetectionProvider, useDetection } from "@/context/DetectionContext";
import { SettingsProvider, useSettings } from "@/context/SettingsContext";
import type { CameraError } from "@/lib/camera";
import type { Size } from "@/lib/detection";
import { DEV_VIDEO_URL } from "@/lib/devVideo";
import { hudSignal } from "@/lib/radarSignal";
import { createWakeLockManager } from "@/lib/wakeLock";

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
    autoZoom,
    getDebugSnapshot,
    error,
    start,
    cameraStalled,
    cameraEpoch,
  } = useDetection();
  const { radarAudio, frameThumbnails, saveFrames, zoomMode, zoomIndicator } =
    useSettings();
  // Dev video mode has no camera to introduce or ask permission for, so the
  // intro is skipped outright and the radar view loads immediately.
  const [showIntro, setShowIntro] = useState(
    () => DEV_VIDEO_URL === null && shouldShowIntro(),
  );
  // The in-app permission ask sits between the intro and the first
  // getUserMedia call, so the browser's own prompt never lands unexplained.
  // Dev video mode never requests the camera, so it skips the ask too.
  const [showCameraPrompt, setShowCameraPrompt] = useState(
    () => DEV_VIDEO_URL === null && shouldShowCameraPrompt(),
  );
  const [cameraPromptDeclined, setCameraPromptDeclined] = useState(false);
  const [cameraError, setCameraError] = useState<CameraError>();
  const [videoSize, setVideoSize] = useState<Size>();
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
      start(video);
    },
    [start, updateVideoSize],
  );

  if (showIntro) {
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
  if (cameraPromptDeclined) {
    return <ErrorScreen code="PERMISSION_DENIED" />;
  }
  if (showCameraPrompt) {
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
  if (cameraError) {
    return <ErrorScreen code={cameraError.code} />;
  }
  if (status === "error" && error) {
    return <ErrorScreen code={error} />;
  }
  // Automatic camera recovery gave up on a frozen or black feed: ask the driver
  // to clear the lens and reload rather than looping silent remounts/reloads.
  if (cameraStalled) {
    return <ErrorScreen code="CAMERA_STALLED" />;
  }

  // While the model is still loading, keep the radar-mode UI unmounted and the
  // camera feed invisible (it stays mounted so getUserMedia fires right after
  // the intro's START tap). Otherwise the radar meter flashes for a beat before
  // the model-download screen covers it; showing only the backdrop grid until
  // the model is ready avoids that flash on both the download and cache paths.
  const modelLoading = status === "loading-model";

  return (
    <main className="fixed inset-0 bg-surface">
      <RadarBackdrop />
      {DEV_VIDEO_URL ? (
        <DevVideoView
          src={DEV_VIDEO_URL}
          scanning={status === "running"}
          onStream={handleStream}
          onVideoResize={updateVideoSize}
        />
      ) : (
        <CameraView
          key={cameraEpoch}
          onStream={handleStream}
          onError={setCameraError}
          onVideoResize={updateVideoSize}
        />
      )}
      {!modelLoading && (
        <RadarDetectorScreen
          confidence={hudSignal(hud)}
          audioEnabled={radarAudio}
          contact={contact}
          frameThumbnails={frameThumbnails}
          saveFrames={saveFrames}
        />
      )}
      <StatusBar
        center={
          zoomIndicator ? (
            <ZoomIndicator
              mode={zoomMode}
              level={autoZoom.zoom}
              locked={autoZoom.locked}
            />
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
      <SettingsScreen backend={backend} />
      {status === "loading-model" && downloadingModel && (
        <ModelLoadScreen progress={modelProgress} />
      )}
    </main>
  );
};

const App = () => {
  return (
    <SettingsProvider>
      <DetectionProvider>
        <RadarScreen />
      </DetectionProvider>
    </SettingsProvider>
  );
};

export default App;
