import { useCallback, useEffect, useMemo, useState } from "react";
import { CameraView } from "@/components/CameraView";
import { ErrorScreen } from "@/components/ErrorScreen";
import { HudOverlay } from "@/components/HudOverlay";
import { ModelLoadScreen } from "@/components/ModelLoadScreen";
import { RadarStrip } from "@/components/RadarStrip";
import { StatusBar } from "@/components/StatusBar";
import { DetectionProvider, useDetection } from "@/context/DetectionContext";
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
  const { status, backend, modelProgress, hud, fps, error, start } =
    useDetection();
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

  const handleStream = useCallback(
    (video: HTMLVideoElement) => {
      setVideoSize({ width: video.videoWidth, height: video.videoHeight });
      start(video);
    },
    [start],
  );

  if (cameraError) {
    return <ErrorScreen code={cameraError.code} />;
  }
  if (status === "error" && error) {
    return <ErrorScreen code={error} />;
  }

  return (
    <main className="fixed inset-0 bg-surface">
      <CameraView onStream={handleStream} onError={setCameraError} />
      {hud && videoSize && (
        <HudOverlay
          hud={hud}
          videoSize={videoSize}
          viewportSize={viewportSize}
        />
      )}
      {hud && <RadarStrip blips={hud.blips} />}
      <StatusBar backend={backend} fps={fps} />
      {status === "loading-model" && (
        <ModelLoadScreen progress={modelProgress} />
      )}
    </main>
  );
};

const App = () => {
  return (
    <DetectionProvider>
      <RadarScreen />
    </DetectionProvider>
  );
};

export default App;
