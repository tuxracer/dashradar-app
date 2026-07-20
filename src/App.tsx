import { useCallback, useEffect, useMemo, useState } from "react";
import { CameraView } from "@/components/CameraView";
import { DebugOverlay } from "@/components/DebugOverlay";
import { ErrorScreen } from "@/components/ErrorScreen";
import { HudOverlay } from "@/components/HudOverlay";
import {
  IntroScreen,
  markIntroSeen,
  shouldShowIntro,
} from "@/components/IntroScreen";
import { ModelLoadScreen } from "@/components/ModelLoadScreen";
import { RadarBackdrop } from "@/components/RadarBackdrop";
import { RadarDetectorScreen } from "@/components/RadarDetectorScreen";
import { RadarStrip } from "@/components/RadarStrip";
import { SettingsScreen } from "@/components/SettingsScreen";
import { StartGate, shouldShowStartGate } from "@/components/StartGate";
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
    fps,
    debug,
    error,
    start,
    getMotionDelta,
    motionPermission,
    requestMotionPermission,
  } = useDetection();
  const {
    showVideo,
    showDebug,
    stabilizeMotion,
    radarDetectorMode,
    settingsOpen,
  } = useSettings();
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
        onStream={handleStream}
        onError={setCameraError}
        onVideoResize={updateVideoSize}
        visible={showVideo && !modelLoading}
      />
      {!modelLoading &&
        (radarDetectorMode ? (
          <RadarDetectorScreen confidence={hudSignal(hud)} />
        ) : (
          <>
            {hud && videoSize && (
              <HudOverlay
                hud={hud}
                videoSize={videoSize}
                viewportSize={viewportSize}
                getMotionDelta={getMotionDelta}
                stabilize={stabilizeMotion}
                debug={showDebug}
              />
            )}
            {hud && <RadarStrip blips={hud.blips} />}
          </>
        ))}
      <StatusBar />
      <DebugOverlay
        backend={backend}
        backendProbe={backendProbe}
        mainThreadWebGpu={mainThreadWebGpu}
        fps={fps}
        modelProgress={modelProgress}
        debug={debug}
        videoSize={videoSize}
        viewportSize={viewportSize}
        getMotionDelta={getMotionDelta}
      />
      <SettingsScreen backend={backend} fps={fps} />
      {status === "loading-model" && downloadingModel && (
        <ModelLoadScreen progress={modelProgress} />
      )}
      {stabilizeMotion &&
        !settingsOpen &&
        shouldShowStartGate(motionPermission) && (
          <StartGate onStart={() => void requestMotionPermission()} />
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
