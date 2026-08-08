import { useEffect, useState } from "react";
import { useSettings } from "@/context/SettingsContext";
import type { DebugSnapshot, ModelProgress } from "@/context/DetectionContext";
import type { Size } from "@/lib/detection";
import type { BackendProbe } from "@/workers/detection/types";
import { READOUT_INTERVAL_MS } from "./consts";

export * from "./consts";

/** Props for DebugOverlay. Data is passed in so it renders without the worker. */
type DebugOverlayProps = {
  backendProbe: BackendProbe | undefined;
  modelProgress: ModelProgress;
  /** Latest per-frame diagnostics; polled on the readout tick. */
  getDebug: () => DebugSnapshot;
  videoSize: Size | undefined;
  viewportSize: Size;
};

/**
 * Whether the session runs with graph capture. "disabled" means no attempt was
 * made; "failed" means it fell back, with `graphCaptureError` saying why.
 */
const captureSupport = (probe: BackendProbe | undefined): string => {
  if (!probe) {
    return "probing";
  }
  if (probe.graphCapture) {
    return "on";
  }
  return probe.graphCaptureError ? "failed" : "disabled";
};

/**
 * Which weights the session came up on, from the provenance stamped into the
 * file: the registry entry only says which file was asked for, so this is what
 * catches a cache serving a different build.
 */
const modelFile = (probe: BackendProbe | undefined): string => {
  if (!probe) {
    return "probing";
  }
  if (!probe.modelFile) {
    return "unreadable";
  }
  const { release_tag, roboflow_model_id } = probe.modelFile.props;
  return release_tag ?? roboflow_model_id ?? "unstamped";
};

/** Milliseconds to one decimal place, e.g. "5.6 ms". */
const ms = (value: number): string => `${value.toFixed(1)} ms`;

/**
 * The gate's running tally. The raw pair rather than the share alone, because a
 * high rate over four scans means nothing.
 */
const gateScans = ({ scansTotal, skipsTotal }: DebugSnapshot): string => {
  const total = scansTotal + skipsTotal;
  const share = total === 0 ? 0 : Math.round((skipsTotal / total) * 100);
  return `${scansTotal} ran · ${skipsTotal} held · ${share}%`;
};

/** One label/value line in the panel. */
const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between gap-4">
    <span className="text-white/50">{label}</span>
    <span className="text-hud-amber">{value}</span>
  </div>
);

/**
 * Development diagnostics panel, pinned top-left below the wordmark. Data comes
 * in as props, so the panel stays testable without the detection worker.
 */
export const DebugOverlay = ({
  backendProbe,
  modelProgress,
  getDebug,
  videoSize,
  viewportSize,
}: DebugOverlayProps) => {
  const { showDebug, throttleInference, sceneChangeGate, zoomMode } =
    useSettings();

  const [debug, setDebug] = useState<DebugSnapshot>(getDebug);
  useEffect(() => {
    // The panel renders nothing while showDebug is off, so don't run the
    // readout (and its state updates) for a hidden overlay.
    if (!showDebug) {
      return;
    }
    // Polled in wall time rather than per frame: the readout has nothing to say
    // between ticks.
    const readout = window.setInterval(() => {
      setDebug(getDebug());
    }, READOUT_INTERVAL_MS);
    return () => window.clearInterval(readout);
  }, [getDebug, showDebug]);

  if (!showDebug) {
    return null;
  }

  const modelPercent =
    modelProgress.totalBytes > 0
      ? `${Math.round((modelProgress.loadedBytes / modelProgress.totalBytes) * 100)}%`
      : "done";
  const videoLabel = videoSize
    ? `${videoSize.width}x${videoSize.height}`
    : "unknown";

  return (
    <div className="pointer-events-none absolute left-4 top-[max(3.5rem,calc(env(safe-area-inset-top)+2.75rem))] z-20 min-w-40 rounded-lg border border-white/15 bg-black/70 px-3 py-2 font-mono text-[11px] leading-relaxed text-white/85 backdrop-blur-sm">
      <div className="mb-1 font-semibold tracking-[0.2em] text-white/60">
        DEBUG
      </div>
      <Row label="graph capture" value={captureSupport(backendProbe)} />
      {backendProbe && (
        <Row
          label="ort wasm"
          value={`${backendProbe.threads}T · ${
            backendProbe.crossOriginIsolated ? "isolated" : "not isolated"
          }`}
        />
      )}
      {backendProbe?.sessionError && (
        <div className="mt-1 border-t border-white/10 pt-1">
          <div className="text-white/50">wgpu session error</div>
          <div className="break-words text-hud-amber">
            {backendProbe.sessionError}
          </div>
        </div>
      )}
      {backendProbe?.graphCaptureError && (
        <div className="mt-1 border-t border-white/10 pt-1">
          <div className="text-white/50">graph capture error</div>
          <div className="break-words text-hud-amber">
            {backendProbe.graphCaptureError}
          </div>
        </div>
      )}
      <Row label="round-trip" value={ms(debug.roundTripMs)} />
      <Row label="throttle" value={throttleInference ? "on" : "off"} />
      <Row
        label="scene gate"
        value={
          sceneChangeGate
            ? `Δ${debug.sceneDelta.toFixed(1)} · ${debug.scanSkips} held`
            : "off"
        }
      />
      {sceneChangeGate && <Row label="gate scans" value={gateScans(debug)} />}
      <Row label="zoom" value={`${zoomMode} · ${debug.zoom}x`} />
      <Row
        label="pacing"
        value={`${ms(debug.pacingDelayMs)} · ${debug.pacingRule}`}
      />
      <Row label="capture" value={ms(debug.captureMs)} />
      {debug.captureFailures > 0 && (
        <Row label="capture retries" value={`${debug.captureFailures}`} />
      )}
      <Row label="preprocess" value={ms(debug.preprocessMs)} />
      <Row label="inference" value={ms(debug.inferenceMs)} />
      <Row label="decode" value={ms(debug.decodeMs)} />
      <Row label="overhead" value={ms(debug.overheadMs)} />
      <Row
        label="detections"
        value={`${debug.shownCount} / ${debug.filteredCount} / ${debug.rawCount}`}
      />
      <Row
        label="viewport"
        value={`${viewportSize.width}x${viewportSize.height}`}
      />
      <Row label="video" value={videoLabel} />
      <Row label="dpr" value={`${window.devicePixelRatio}`} />
      <Row label="model" value={modelPercent} />
      <Row label="weights" value={modelFile(backendProbe)} />
    </div>
  );
};
