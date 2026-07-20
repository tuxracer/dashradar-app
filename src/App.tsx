import { useCallback, useEffect, useMemo, useState } from "react";
import { CameraView } from "@/components/CameraView";
import { DebugOverlay } from "@/components/DebugOverlay";
import { ErrorScreen } from "@/components/ErrorScreen";
import { HudOverlay } from "@/components/HudOverlay";
import { ModelLoadScreen } from "@/components/ModelLoadScreen";
import { RadarBackdrop } from "@/components/RadarBackdrop";
import { RadarStrip } from "@/components/RadarStrip";
import { SettingsScreen } from "@/components/SettingsScreen";
import { StatusBar } from "@/components/StatusBar";
import { DetectionProvider, useDetection } from "@/context/DetectionContext";
import { SettingsProvider, useSettings } from "@/context/SettingsContext";
import type { CameraError } from "@/lib/camera";
import type { Size } from "@/lib/detection";
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
  const { status, backend, modelProgress, hud, fps, debug, error, start } =
    useDetection();
  const { showVideo, showDebug } = useSettings();
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

  if (cameraError) {
    return <ErrorScreen code={cameraError.code} />;
  }
  if (status === "error" && error) {
    return <ErrorScreen code={error} />;
  }

  return (
    <main className="fixed inset-0 bg-surface">
      <RadarBackdrop />
      <CameraView
        onStream={handleStream}
        onError={setCameraError}
        onVideoResize={updateVideoSize}
        visible={showVideo}
      />
      {hud && videoSize && (
        <HudOverlay
          hud={hud}
          videoSize={videoSize}
          viewportSize={viewportSize}
          debug={showDebug}
        />
      )}
      {hud && <RadarStrip blips={hud.blips} />}
      <StatusBar />
      <DebugOverlay
        backend={backend}
        fps={fps}
        modelProgress={modelProgress}
        debug={debug}
        videoSize={videoSize}
        viewportSize={viewportSize}
      />
      <SettingsScreen backend={backend} fps={fps} />
      {status === "loading-model" && (
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
