import { useCallback, useEffect, useState } from "react";
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
import { SceneView } from "@/components/SceneView";
import { SettingsScreen } from "@/components/SettingsScreen";
import { StatusBar } from "@/components/StatusBar";
import { UnsupportedScreen } from "@/components/UnsupportedScreen";
import { VideoDropTarget } from "@/components/VideoDropTarget";
import { VideoFileView } from "@/components/VideoFileView";
import { ZoomIndicator } from "@/components/ZoomIndicator";
import { DetectionProvider, useDetection } from "@/context/DetectionContext";
import { SettingsProvider, useSettings } from "@/context/SettingsContext";
import {
  useVideoSource,
  VideoSourceProvider,
} from "@/context/VideoSourceContext";
import type { CameraError, CameraFeedEvent } from "@/lib/camera";
import type { Size } from "@/lib/detection";
import { DEFAULT_MODEL } from "@/lib/detectionModels";
import { isDesktopDevice } from "@/lib/deviceType";
import { hudScore, hudSignal } from "@/lib/radarSignal";
import {
  UPDATE_CHECK_TIMEOUT_MS,
  UPDATE_PENDING_TIMEOUT_MS,
  waitForUpdateSettled,
} from "@/lib/serviceWorker";
import type { VideoFileFeedEvent } from "@/lib/videoFileFeed";
import { primeScreenWakeLock } from "@/lib/wakeLock";
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
    getDebugSnapshot,
    error,
    scan,
    attachVideo,
    activeModel,
    allowModelLoad,
  } = useDetection();
  const {
    radarAudio,
    zoomMode,
    zoomIndicator,
    roundTripIndicator,
    cameraPreview,
    rawConfidence,
    detectionView,
    viewMode,
    setViewMode,
    sceneFov,
    showDebug,
    commitModelIds,
  } = useSettings();
  // A dropped or picked clip outranks every screen below that exists because of
  // the camera. Not checked in the initializers, since both ways to reach a file
  // need the app running first.
  const { source, feedId, clearVideoFile } = useVideoSource();
  const [showIntro, setShowIntro] = useState(shouldShowIntro);
  // The in-app permission ask sits between the intro and the first
  // getUserMedia call, so the browser's own prompt never lands unexplained.
  const [showCameraPrompt, setShowCameraPrompt] = useState(
    shouldShowCameraPrompt,
  );
  const [cameraPromptDeclined, setCameraPromptDeclined] = useState(false);
  const [videoSize, setVideoSize] = useState<Size>();
  const viewportSize = useViewportSize();

  // Stamped with the feed that produced them, not the session: clearing a clip
  // that stood in for a camera which would not open mounts a fresh CameraView,
  // and an old refusal carried over would never ask the camera again.
  const [feedFailure, setFeedFailure] = useState<{
    feedId: number;
    error: CameraError;
  }>();
  const cameraError =
    feedFailure?.feedId === feedId ? feedFailure.error : undefined;
  // Kept so the developer camera preview can mirror it.
  const [feedElement, setFeedElement] = useState<{
    feedId: number;
    video: HTMLVideoElement;
  }>();
  const feedVideo =
    feedElement?.feedId === feedId ? feedElement.video : undefined;

  const handleCameraError = useCallback(
    (error: CameraError) => {
      setFeedFailure({ feedId, error });
    },
    [feedId],
  );

  const introVisible = showIntro && !source;

  // A desktop holds the download until here, since its intro is a handoff to a
  // phone rather than a way in. A phone never defers, so this is a no-op there.
  useEffect(() => {
    if (!introVisible) {
      allowModelLoad();
    }
  }, [allowModelLoad, introVisible]);

  // iOS re-prompts for the camera every launch of an installed web app, and an
  // update found at launch reloads right after Allow and prompts again. Waiting
  // for the check reorders that launch to reload first.
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

  // Camera errors surface only here, where getUserMedia's result reaches the UI;
  // detection-side failures are tracked at their source. The permission-denied
  // rate is the app's most valuable funnel signal and its only view into one.
  useEffect(() => {
    if (cameraError) {
      track("error", { code: cameraError.code });
    }
  }, [cameraError]);

  const updateVideoSize = useCallback((video: HTMLVideoElement) => {
    setVideoSize({ width: video.videoWidth, height: video.videoHeight });
  }, []);

  // Both feeds report the same events, so one handler covers either: the pump
  // only learns that some element is live and how big its frames are.
  const handleFeedEvent = useCallback(
    (event: CameraFeedEvent | VideoFileFeedEvent) => {
      updateVideoSize(event.video);
      if (event.type === "active") {
        setFeedElement({ feedId, video: event.video });
        attachVideo(event.video);
      }
    },
    [attachVideo, feedId, updateVideoSize],
  );

  if (introVisible) {
    return (
      <IntroScreen
        onStart={() => {
          track("intro_start");
          // Every tap on the way to scanning primes the wake lock, since any of
          // them can be the last of the drive. A returning launch sees neither
          // this screen nor the ask, so the lock also retries on its own.
          primeScreenWakeLock();
          markIntroSeen();
          setShowIntro(false);
        }}
      />
    );
  }
  // After the intro and ahead of every camera screen: everyone is told what the
  // app is for, but nobody is asked for access their phone cannot use. Its own
  // screen rather than an ErrorScreen code, since there is nothing to retry.
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
          // The last tap before scanning on a first visit; see the intro's.
          primeScreenWakeLock();
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
    // A model that will not load has a better recovery than retrying it. Through
    // commitModelIds so the reload only happens once the write landed, or the
    // page comes back running the very model this button exists to escape.
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

  // The camera is acquired only once the model is loaded and warmed. Session
  // creation plus warm-up is the heaviest moment the GPU process sees, and a live
  // stream holds buffers throughout, so overlapping them puts both peaks on one
  // instant.
  const modelLoading = status === "loading-model";

  // The developer detection view overrides both user-facing views; the
  // status-bar toggle hides itself while it is on for the same reason.
  const sceneMode = !detectionView && viewMode === "scene";

  return (
    // The marker class the scene-light variant hangs off: the chrome above the
    // scene has to know which view it is drawn over before it can pick its ink.
    <main
      className={`fixed inset-0 bg-surface ${sceneMode ? "scene-view" : ""}`}
    >
      {!detectionView && !sceneMode && <RadarBackdrop />}
      {source ? (
        // Not held back the way the camera is: a local file has neither the
        // permission prompt nor the buffers. Gating it would strand the sessions
        // this feed exists for, the ones with no camera to fall back to.
        <VideoFileView
          key={source.url}
          src={source.url}
          fullScreen={detectionView}
          onEvent={handleFeedEvent}
          onError={clearVideoFile}
        />
      ) : (
        /* Held back until the model is ready and the update check settles. No
           deadlock: the worker parks at "ready" when no camera has started, and
           this mount is what advances it to "running". A recycle never returns
           to "loading-model", so it cannot tear the camera down mid-drive. */
        !modelLoading &&
        updateSettled && (
          <CameraView
            visible={detectionView}
            onEvent={handleFeedEvent}
            onError={handleCameraError}
          />
        )
      )}
      {/* The meter and the scene both mount immediately, so the first paint past
          the permission flow is an instrument reading INITIALIZING rather than a
          blank backdrop. The detection view has no such instrument and stays
          blank until the first scan lands. */}
      {detectionView ? (
        <DetectionView
          detections={scan?.detections ?? []}
          frame={scan?.frame ?? videoSize ?? viewportSize}
          viewport={viewportSize}
          zoom={scan?.zoom ?? ZOOM_OFF}
        />
      ) : sceneMode ? (
        <SceneView
          tracks={scan?.tracks ?? []}
          scanAt={scan?.at}
          frame={scan?.frame}
          fovDeg={sceneFov}
          confidence={hudSignal(hud)}
          audioEnabled={radarAudio}
          initializing={status !== "running"}
          debug={showDebug}
          // Mutates the persisted setting on purpose: leaving it on "scene"
          // while the radar renders would show a toggle claiming the wrong view.
          onRenderFailure={() => setViewMode("radar")}
        />
      ) : (
        <RadarDetectorScreen
          confidence={hudSignal(hud)}
          audioEnabled={radarAudio}
          contact={contact}
          initializing={status !== "running"}
          rawConfidence={rawConfidence ? hudScore(hud) : undefined}
          detectedLabel={hud?.top?.label}
        />
      )}

      {/* The zoom mirrors what the engine posts on each detect message, so the
          preview narrows to the region the next capture actually scans. Never in
          the detection view, where the full feed is already on screen and the
          inset would be a second live video surface cropping the first. */}
      {!modelLoading && cameraPreview && !detectionView && feedVideo && (
        <CameraPreview
          source={feedVideo}
          zoom={zoomMode === "2x" ? ZOOM_2X : ZOOM_OFF}
        />
      )}
      <StatusBar
        center={
          zoomIndicator || roundTripIndicator ? (
            <span className="flex items-center gap-2">
              {zoomIndicator && <ZoomIndicator mode={zoomMode} />}
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
      {/* A phone downloads the weights under the intro someone is still reading,
          since that download is the longest part of a first visit. A desktop
          holds them until RadarScreen says the intro is behind it. */}
      <DetectionProvider deferModelLoad={isDesktopDevice()}>
        {/* Inside DetectionProvider, which it consumes: a feed swap detaches the
            engine's video before the element it captured from unmounts. */}
        <VideoSourceProvider>
          <VideoDropTarget />
          <RadarScreen />
        </VideoSourceProvider>
      </DetectionProvider>
    </SettingsProvider>
  );
};

export default App;
