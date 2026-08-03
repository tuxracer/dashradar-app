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
  /** Test seam: defaults to the real detection worker. */
  createWorker?: () => DetectionWorkerLike;
};

/**
 * Thin React adapter over the detection engine (src/lib/detectionEngine),
 * which owns the worker lifecycle and the frame pump. This provider creates
 * the engine, mirrors its snapshots into React via useSyncExternalStore, and
 * pushes the world state the engine derives its running state from: the
 * attached video element, page visibility, whether the settings panel is
 * open, and the effective settings. Nothing here pumps frames or holds pump
 * state.
 */
export const DetectionProvider = ({
  children,
  createWorker = createDetectionWorker,
}: DetectionProviderProps) => {
  const {
    detectionImage,
    throttleInference,
    zoomMode,
    confidenceThreshold,
    modelIds,
    settingsOpen,
  } = useSettings();
  // Pinned at mount, not tracked. Changing the model applies by reloading the
  // page (the model screen reloads on save), so a selection changed underneath
  // a live session must not reach it; the pin also covers the engine's
  // periodic worker recycle, which rebuilds a session 15 minutes in.
  const [activeModel] = useState(() => resolveModels(modelIds)[0]);
  // The analytics sink for this page load; owns every once-per-load gate and
  // the scanning clock. Creating it has no side effects, so a discarded
  // StrictMode duplicate costs nothing. The same goes for the engine, which
  // is inert until the activation effect below spawns its worker.
  const [telemetry] = useState(() => createDetectionTelemetry(activeModel));
  const [engine] = useState(() =>
    createDetectionEngine({ model: activeModel, createWorker, telemetry }),
  );

  // Mount and unmount the engine with the provider. StrictMode runs this
  // effect, its cleanup, and the effect again; the engine's activate resets
  // published state so the pair behaves like a fresh mount.
  useEffect(() => {
    engine.activate();
    return () => {
      engine.deactivate();
    };
  }, [engine]);

  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot);

  // Push the effective settings; the engine reads them per capture. The
  // provider maps the zoom mode to the crop factor so the engine never learns
  // the settings vocabulary.
  useEffect(() => {
    engine.updateSettings({
      includeContact: detectionImage,
      throttled: throttleInference,
      zoom: zoomMode === "2x" ? ZOOM_2X : ZOOM_OFF,
      confidenceThreshold,
    });
  }, [
    engine,
    detectionImage,
    throttleInference,
    zoomMode,
    confidenceThreshold,
  ]);

  // The settings panel is a same-page overlay (no visibilitychange), so its
  // open state is an explicit input; the engine pauses scanning behind it,
  // which would otherwise burn battery on results nobody can see.
  useEffect(() => {
    engine.setInputs({ settingsOpen });
  }, [engine, settingsOpen]);

  // Page visibility (app switched away, screen off). Without this the pump
  // would keep capturing and running inference in the background until the OS
  // froze the tab.
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

  // Report how long this drive actually scanned, when it goes away. Both
  // listeners fire the same report, because neither alone covers the ways a
  // drive ends: `pagehide` catches a navigation or reload, and a page going
  // hidden catches the far more common one, the phone backgrounded or locked
  // at the end of a trip. The telemetry sink drains its clock per report, so
  // the two never double-count one drive.
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

  // The detection-image setting decides whether there is a contact card at
  // all, so the gate lives here rather than in the consumer: turning it off
  // drops the card already on screen the same instant it stops the worker
  // from cutting new ones, and every consumer sees one answer.
  const shownContact = detectionImage ? snapshot.contact : undefined;

  const value = useMemo(
    () => ({
      ...snapshot,
      contact: shownContact,
      getDebugSnapshot: engine.getDebugSnapshot,
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
