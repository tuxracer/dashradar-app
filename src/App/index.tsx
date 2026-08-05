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
  // A dropped or picked clip outranks every screen below that exists because
  // of the camera. No check on it in the initializers, though: a session
  // always starts on the camera, since both ways to reach a file need the app
  // running first.
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

  // Both of these belong to one feed rather than to the session, so both are
  // stamped with the feed that produced them and read back only while that
  // feed is still the one on screen. The camera failure is why: a clip
  // standing in for a camera that would not open unmounts CameraView, and
  // clearing the clip mounts a fresh one whose getUserMedia call has to get
  // to answer for itself. Carrying the old refusal over would put the error
  // screen back up without ever asking the camera again.
  const [feedFailure, setFeedFailure] = useState<{
    feedId: number;
    error: CameraError;
  }>();
  const cameraError =
    feedFailure?.feedId === feedId ? feedFailure.error : undefined;
  // The element the detector is capturing from, kept so the developer camera
  // preview can mirror it.
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

  // Whether the first-open intro is what this render shows; see the matching
  // return below.
  const introVisible = showIntro && !source;

  // On a desktop the model download waits for this, because the intro there is
  // a handoff to a phone rather than a way in: tens of megabytes of weights are
  // worth fetching once someone has decided to run the detector on this
  // machine, not while they are being offered the QR code. A phone never defers
  // (see the DetectionProvider below), so this is a no-op there, and a
  // returning visitor, who is shown no intro at all, releases it at mount.
  useEffect(() => {
    if (!introVisible) {
      allowModelLoad();
    }
  }, [allowModelLoad, introVisible]);

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

  // Both feeds report the same events, so one handler covers whichever of them
  // is on: the pump only ever learns that some element is live and how big its
  // frames are.
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
          // Every tap on the way to scanning primes the wake lock, since any
          // of them can be the last one of the drive. A returning launch shows
          // neither this screen nor the permission ask, which is why the lock
          // itself also retries on the first gesture it sees.
          primeScreenWakeLock();
          markIntroSeen();
          setShowIntro(false);
        }}
      />
    );
  }
  // This device cannot run inference at all, so nothing past here has anything
  // to show. Sits directly after the intro and ahead of
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
    // A selected model that will not load has a better recovery than retrying
    // it: run the default. Committed through commitModelIds for the same
    // reason the model screen uses it: it confirms the write landed, and the
    // reload only happens when it did, or the page would come back running
    // the very model this button exists to escape.
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

  // The developer detection view overrides both user-facing views; the
  // status-bar toggle hides itself while it is on for the same reason.
  const sceneMode = !detectionView && viewMode === "scene";

  return (
    // The marker class is what the scene-light variant hangs off: the scene
    // view is the only one that follows the phone's color scheme, so the
    // chrome above it needs to know which view it is drawn over before it can
    // pick its ink (see globals.css).
    <main
      className={`fixed inset-0 bg-surface ${sceneMode ? "scene-view" : ""}`}
    >
      {!detectionView && !sceneMode && <RadarBackdrop />}
      {source ? (
        // Not held back the way the camera below is: that gate is about the
        // permission prompt and the buffers a live 1024px stream holds through
        // the model's compile, and a local file the user just handed over has
        // neither. Gating it would also strand the sessions this feed exists
        // for, the ones with no camera to fall back to.
        <VideoFileView
          key={source.url}
          src={source.url}
          fullScreen={detectionView}
          onEvent={handleFeedEvent}
          onError={clearVideoFile}
        />
      ) : (
        /* Held back until the model is ready (see modelLoading above) and the
           launch update check settles (see updateSettled above). The "ready"
           handler parks at status "ready" when no camera has started, and this
           mount's start() is what advances it to "running", so the ordering
           has no deadlock. A worker recycle never returns status to
           "loading-model", so it cannot tear the camera back down mid-drive. */
        !modelLoading &&
        updateSettled && (
          <CameraView
            visible={detectionView}
            onEvent={handleFeedEvent}
            onError={handleCameraError}
          />
        )
      )}
      {/* In the radar-meter branch below, the meter mounts immediately so the
          first paint past the permission flow is the instrument reading
          INITIALIZING, not a blank backdrop; the sweep advances one arc step
          per completed scan once detection is running. The
          detection-view branch has no such instrument, so its
          pre-camera frames are a blank backdrop until the first scan lands. A
          first-visit download is still covered by the opaque ModelLoadScreen
          below. The scene branch mounts like the meter: grid and ego render
          at once with the status strip reading INITIALIZING. */}
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
          // Falling back mutates the persisted setting on purpose: leaving it
          // on "scene" while the radar renders would show a toggle claiming a
          // view the screen is not in.
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

      {/* The zoom mirrors the zoom field the engine posts on each detect
          message, so the preview always narrows to the region the next
          capture actually scans. */}
      {/* Not in the detection view: the full feed is already on screen behind
          it, so the inset would be a second live video surface cropping from
          the one underneath it. */}
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
      {/* A phone starts downloading the weights the moment the app loads, under
          the intro someone is still reading, since that download is the longest
          part of a first visit. A desktop holds them until RadarScreen says the
          intro is behind it. */}
      <DetectionProvider deferModelLoad={isDesktopDevice()}>
        {/* VideoSourceProvider sits inside DetectionProvider, which it
            consumes: a feed swap detaches the engine's video before the
            element it was capturing from unmounts. */}
        <VideoSourceProvider>
          <VideoDropTarget />
          <RadarScreen />
        </VideoSourceProvider>
      </DetectionProvider>
    </SettingsProvider>
  );
};

export default App;
