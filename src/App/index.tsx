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
import { DetectionView } from "@/components/DetectionView";
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
import { UnsupportedScreen } from "@/components/UnsupportedScreen";
import { VideoDropTarget } from "@/components/VideoDropTarget";
import { ZoomIndicator } from "@/components/ZoomIndicator";
import { DetectionProvider, useDetection } from "@/context/DetectionContext";
import { DevVideoProvider, useDevVideo } from "@/context/DevVideoContext";
import { SettingsProvider, useSettings } from "@/context/SettingsContext";
import type { CameraError } from "@/lib/camera";
import type { Size } from "@/lib/detection";
import { DEFAULT_MODEL } from "@/lib/detectionModels";
import { hudScore, hudSignal } from "@/lib/radarSignal";
import {
  UPDATE_CHECK_TIMEOUT_MS,
  UPDATE_PENDING_TIMEOUT_MS,
  waitForUpdateSettled,
} from "@/lib/serviceWorker";
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
    backendProbe,
    downloadingModel,
    modelProgress,
    hud,
    contact,
    savedFrame,
    autoZoom,
    getDebugSnapshot,
    error,
    scan,
    start,
    swapVideoSource,
    activeModel,
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
    detectionView,
    commitModelIds,
  } = useSettings();
  const { source } = useDevVideo();
  // No check on `source` in either initializer: a session always starts on the
  // camera, since the only ways to reach a file feed are a drop or the
  // settings picker, both of which need the app running first. A file chosen
  // later outranks these screens through the `!source` guards below.
  const [showIntro, setShowIntro] = useState(shouldShowIntro);
  // The in-app permission ask sits between the intro and the first
  // getUserMedia call, so the browser's own prompt never lands unexplained.
  const [showCameraPrompt, setShowCameraPrompt] = useState(
    shouldShowCameraPrompt,
  );
  const [cameraPromptDeclined, setCameraPromptDeclined] = useState(false);
  const [cameraError, setCameraError] = useState<CameraError>();
  const [videoSize, setVideoSize] = useState<Size>();
  // The camera's video element, kept so the developer camera preview can play
  // the same MediaStream. Refreshed on every stream (re)start.
  const [cameraVideo, setCameraVideo] = useState<HTMLVideoElement>();
  const viewportSize = useViewportSize();
  const wakeLock = useMemo(() => createWakeLockManager(), []);

  // iOS forgets camera permission between launches of an installed web app,
  // so every launch re-prompts. When an app update is found at launch, the
  // silent auto-update reload lands right after the driver taps Allow and
  // prompts them a second time. Holding the camera until the launch update
  // check settles reorders that launch to reload first, one prompt total;
  // with no update pending, the check resolves during the model load and
  // delays nothing.
  const [updateSettled, setUpdateSettled] = useState(false);
  useEffect(() => {
    let disposed = false;
    void waitForUpdateSettled({
      checkTimeoutMs: UPDATE_CHECK_TIMEOUT_MS,
      pendingTimeoutMs: UPDATE_PENDING_TIMEOUT_MS,
    }).then(() => {
      if (!disposed) {
        setUpdateSettled(true);
      }
    });
    return () => {
      disposed = true;
    };
  }, []);

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
  // goes back to the camera. Leaving it in place would park the pump on a
  // frame callback that never fires, and the meter would read SCANNING for
  // the rest of the drive.
  const handleDevVideoError = useCallback(() => {
    swapVideoSource(null);
  }, [swapVideoSource]);

  // Returning to the camera gives it a clean slate: a permission error
  // recorded before the clip was loaded must not pre-empt the fresh
  // getUserMedia call the remounting CameraView is about to make. It is the
  // only screen a clip must not restore, which is why it resets here while
  // every other camera screen is merely outranked by a source. The ref
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
  }, [source]);

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
  // This device cannot run inference at all, so nothing past here has anything
  // to show, video file included. Sits directly after the intro and ahead of
  // every camera screen: everyone still gets told what the app is for, but
  // nobody is asked for camera access their phone can't make use of. The
  // worker's GPU probe answers within milliseconds of mount, well inside the
  // time the intro is on screen, so in practice this is the screen the START
  // tap lands on rather than a late interruption. Its own screen rather than an
  // ErrorScreen code, since there is nothing to retry here, only somewhere
  // better to go; narrowing it here is also what lets the ErrorScreen below
  // typecheck, as AppErrorCode excludes it.
  if (error === "WEBGPU_UNSUPPORTED") {
    return <UnsupportedScreen />;
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
    // A selected model that will not load has a better recovery than retrying
    // it: run the default. Committed synchronously for the same reason the
    // model screen does it; the reload on the next line outruns the persist
    // effect.
    const revertAction =
      error === "MODEL_LOAD_FAILED" && activeModel.id !== DEFAULT_MODEL.id
        ? {
            label: "USE DEFAULT MODEL",
            onClick: () => {
              if (commitModelIds([DEFAULT_MODEL.id])) {
                window.location.reload();
              }
            },
          }
        : undefined;
    return <ErrorScreen code={error} action={revertAction} />;
  }

  // The camera is acquired only once the model is loaded and warmed, never
  // alongside it. Session creation plus the worker's warm-up run is the
  // heaviest moment the GPU process sees, and a live 1024x1024 stream holds
  // buffers of its own throughout; overlapping the two put both peaks on the
  // same instant, which is where every field crash landed (DASHRADAR-2). The
  // cost is that the browser's permission prompt now follows the model load
  // rather than racing it, which on a first visit means it appears after the
  // download screen instead of over it.
  const modelLoading = status === "loading-model";

  return (
    <main className="fixed inset-0 bg-surface">
      {!detectionView && <RadarBackdrop />}
      {source ? (
        <DevVideoView
          key={source.url}
          src={source.url}
          scanning={status === "running"}
          fullScreen={detectionView}
          onStream={handleStream}
          onVideoResize={updateVideoSize}
          onError={handleDevVideoError}
        />
      ) : (
        // Held back until the model is ready (see modelLoading above) and the
        // launch update check settles (see updateSettled above). The "ready"
        // handler parks at status "ready" when no camera has started, and this
        // mount's start() is what advances it to "running", so the ordering
        // has no deadlock. A worker recycle never returns status to
        // "loading-model", so it cannot tear the camera back down mid-drive.
        !modelLoading &&
        updateSettled && (
          <CameraView
            visible={detectionView}
            onStream={handleStream}
            onError={setCameraError}
            onVideoResize={updateVideoSize}
          />
        )
      )}
      {/* In the radar-meter branch below, the meter mounts immediately so the
          first paint past the permission flow is the instrument reading
          INITIALIZING, not a blank backdrop; the sweep starts once detection
          is running. The detection-view branch has no such instrument, so its
          pre-camera frames are a blank backdrop until the first scan lands. A
          first-visit download is still covered by the opaque ModelLoadScreen
          below. */}
      {detectionView ? (
        <DetectionView
          detections={scan?.detections ?? []}
          frame={scan?.frame ?? videoSize ?? viewportSize}
          viewport={viewportSize}
          zoom={scan?.zoom ?? ZOOM_OFF}
        />
      ) : (
        <RadarDetectorScreen
          confidence={hudSignal(hud)}
          audioEnabled={radarAudio}
          contact={contact}
          frameThumbnails={frameThumbnails}
          saveFrames={saveFrames}
          initializing={status !== "running"}
          rawConfidence={rawConfidence ? hudScore(hud) : undefined}
          detectedLabel={hud?.top?.label}
        />
      )}

      {/* The zoom mirrors sendFrame's mapping, so the preview always narrows
          to the region the next capture actually scans. Mounted in dev video
          mode too: the corner player shows the whole clip, the preview the
          crop. */}
      {/* Not in the detection view: the full feed is already on screen behind
          it, so the inset would be a second live video surface cropping from
          the one underneath it. */}
      {!modelLoading && cameraPreview && !detectionView && cameraVideo && (
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
        backendProbe={backendProbe}
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
