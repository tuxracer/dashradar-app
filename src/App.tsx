import { useCallback, useEffect, useMemo, useState } from "react";
import { track } from "@vercel/analytics";
import { CameraView } from "@/components/CameraView";
import { DebugOverlay } from "@/components/DebugOverlay";
import { ErrorScreen } from "@/components/ErrorScreen";
import {
  IntroScreen,
  markIntroSeen,
  shouldShowIntro,
} from "@/components/IntroScreen";
import { ModelLoadScreen } from "@/components/ModelLoadScreen";
import { RadarBackdrop } from "@/components/RadarBackdrop";
import { RadarDetectorScreen } from "@/components/RadarDetectorScreen";
import { RecoveryOverlay } from "@/components/RecoveryOverlay";
import { SettingsScreen } from "@/components/SettingsScreen";
import { StatusBar } from "@/components/StatusBar";
import { DetectionProvider, useDetection } from "@/context/DetectionContext";
import { SettingsProvider, useSettings } from "@/context/SettingsContext";
import type { CameraError } from "@/lib/camera";
import type { Size } from "@/lib/detection";
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
    getFps,
    getDebugSnapshot,
    error,
    start,
    recovering,
    cameraEpoch,
  } = useDetection();
  const { showDebug, radarAudio } = useSettings();
  const [showIntro, setShowIntro] = useState(shouldShowIntro);
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
  if (cameraError) {
    return <ErrorScreen code={cameraError.code} />;
  }
  if (status === "error" && error) {
    return <ErrorScreen code={error} />;
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
      <CameraView
        key={cameraEpoch}
        onStream={handleStream}
        onError={setCameraError}
        onVideoResize={updateVideoSize}
      />
      {!modelLoading && (
        <RadarDetectorScreen
          confidence={hudSignal(hud)}
          audioEnabled={radarAudio}
          contact={contact}
          debug={showDebug}
        />
      )}
      <RecoveryOverlay visible={recovering} />
      <StatusBar />
      <DebugOverlay
        backend={backend}
        backendProbe={backendProbe}
        mainThreadWebGpu={mainThreadWebGpu}
        getFps={getFps}
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
