import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { useSettings } from "@/context/SettingsContext";
import { createDetectionEngine } from "@/lib/detectionEngine";
import type { DetectionWorkerLike } from "@/lib/detectionEngine";
import { resolveModels } from "@/lib/detectionModels";
import { createDetectionTelemetry } from "@/lib/detectionTelemetry";
import { ZOOM_2X, ZOOM_OFF } from "@/workers/detection/consts";
import type { DetectionContextValue } from "./types";

export * from "./consts";
export * from "./types";

const DetectionContext = createContext<DetectionContextValue | undefined>(
  undefined,
);

export const useDetection = (): DetectionContextValue => {
  const value = useContext(DetectionContext);
  if (!value) {
    throw new Error("useDetection must be used within a DetectionProvider");
  }
  return value;
};

const createDetectionWorker = (): DetectionWorkerLike => {
  return new Worker(
    new URL("../../workers/detection/index.ts", import.meta.url),
    { type: "module" },
  );
};

type DetectionProviderProps = {
  children: ReactNode;
  /**
   * Hold the weights back until the first `allowModelLoad()`. The GPU probe goes
   * out immediately either way, so an unsupported device is still turned away.
   */
  deferModelLoad?: boolean;
  /** Test seam: defaults to the real detection worker. */
  createWorker?: () => DetectionWorkerLike;
};

/**
 * Thin React adapter over the detection engine, which owns the worker lifecycle
 * and the frame pump. This creates the engine, mirrors its snapshots through
 * useSyncExternalStore, and pushes in the world state it derives running from.
 * Nothing here pumps frames or holds pump state.
 */
export const DetectionProvider = ({
  children,
  deferModelLoad = false,
  createWorker = createDetectionWorker,
}: DetectionProviderProps) => {
  const {
    detectionImage,
    throttleInference,
    sceneChangeGate,
    zoomMode,
    confidenceThreshold,
    consoleDiagnostics,
    modelIds,
    settingsOpen,
    detectionView,
    viewMode,
  } = useSettings();
  // Pinned at mount, not tracked: a model change applies by reloading the page,
  // so a selection changed underneath a live session must not reach it. The pin
  // also covers the engine's periodic worker recycle.
  const [activeModel] = useState(() => resolveModels(modelIds)[0]);
  // The analytics sink for this page load, owning every once-per-load gate and
  // the scanning clock. Creating it has no side effects, so a discarded
  // StrictMode duplicate costs nothing; the engine is inert until activated.
  const [telemetry] = useState(() => createDetectionTelemetry(activeModel));
  const [engine] = useState(() =>
    // Read here and never again: the download has to be withheld before the
    // first worker exists, which is earlier than any effect runs.
    createDetectionEngine({
      model: activeModel,
      createWorker,
      telemetry,
      deferModelLoad,
    }),
  );

  // StrictMode runs this effect, its cleanup, and the effect again; activate
  // resets published state so the pair behaves like a fresh mount.
  useEffect(() => {
    engine.activate();
    return () => {
      engine.deactivate();
    };
  }, [engine]);

  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot);

  // Read per capture. The zoom mode is mapped to a crop factor here so the
  // engine never learns the settings vocabulary.
  useEffect(() => {
    engine.updateSettings({
      includeContact: detectionImage,
      throttled: throttleInference,
      sceneGate: sceneChangeGate,
      zoom: zoomMode === "2x" ? ZOOM_2X : ZOOM_OFF,
      confidenceThreshold,
      consoleDiagnostics,
    });
  }, [
    engine,
    detectionImage,
    throttleInference,
    sceneChangeGate,
    zoomMode,
    confidenceThreshold,
    consoleDiagnostics,
  ]);

  // The settings panel is a same-page overlay, so nothing else reports it. The
  // engine pauses behind it rather than burning battery on unseen results.
  useEffect(() => {
    engine.setInputs({ settingsOpen });
  }, [engine, settingsOpen]);

  // Derived here so the engine never learns that the detection view outranks the
  // radar/scene choice, only which of the three is drawing. Changes no behavior
  // and is carried purely so a crash report can name it.
  useEffect(() => {
    engine.setInputs({
      activeView: detectionView ? "detection" : viewMode,
    });
  }, [engine, detectionView, viewMode]);

  // Without this the pump would keep running inference in the background until
  // the OS froze the tab.
  useEffect(() => {
    const update = () => {
      engine.setInputs({ visible: document.visibilityState !== "hidden" });
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
    };
  }, [engine]);

  // Neither listener alone covers how a drive ends: pagehide catches a
  // navigation or reload, hidden catches the far more common phone backgrounded
  // or locked. The sink drains its clock per report, so they cannot double-count.
  useEffect(() => {
    const reportScanSession = () => {
      telemetry.reportScanSession();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        reportScanSession();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", reportScanSession);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", reportScanSession);
    };
  }, [telemetry]);

  const attachVideo = useCallback(
    (video: HTMLVideoElement) => {
      engine.setInputs({ video });
    },
    [engine],
  );
  const detachVideo = useCallback(() => {
    engine.setInputs({ video: undefined });
  }, [engine]);

  // Gated here rather than in the consumer, so turning the setting off drops the
  // card already on screen the same instant it stops new cutouts, and every
  // consumer sees one answer.
  const shownContact = detectionImage ? snapshot.contact : undefined;

  const value = useMemo(
    () => ({
      ...snapshot,
      contact: shownContact,
      getDebugSnapshot: engine.getDebugSnapshot,
      allowModelLoad: engine.allowModelLoad,
      activeModel,
      attachVideo,
      detachVideo,
    }),
    [snapshot, shownContact, engine, activeModel, attachVideo, detachVideo],
  );

  return (
    <DetectionContext.Provider value={value}>
      {children}
    </DetectionContext.Provider>
  );
};
