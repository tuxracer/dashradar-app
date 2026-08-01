import { useEffect, useState } from "react";
import { useSettings } from "@/context/SettingsContext";
import type { DebugSnapshot, ModelProgress } from "@/context/DetectionContext";
import type { Size } from "@/lib/detection";
import type { BackendProbe } from "@/workers/detection/types";

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
 * Whether the WebGPU session runs with graph capture (recorded kernel
 * dispatches replayed per frame). "disabled" means no attempt was made: the
 * `WEBGPU_GRAPH_CAPTURE` flag is off, or the browser is WebKit, where capture
 * measures no faster and is skipped (see the flag's doc in the worker's
 * consts.ts); "failed" means the attempt was made and the worker fell back to
 * a plain session, with the probe's `graphCaptureError` block below the rows
 * saying why.
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

/** Milliseconds to one decimal place, e.g. "5.6 ms". */
const ms = (value: number): string => `${value.toFixed(1)} ms`;

/** One label/value line in the panel. */
const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between gap-4">
    <span className="text-white/50">{label}</span>
    <span className="text-hud-amber">{value}</span>
  </div>
);

/**
 * Development diagnostics panel pinned to the top-left, below the wordmark line.
 * Rendered only when the showDebug setting is on. pointer-events are disabled so
 * it never intercepts taps meant for the HUD. Data comes in as props (the
 * backend probe, model progress, the per-frame debug snapshot, and the current
 * sizes) so the panel stays testable without the detection worker.
 */
export const DebugOverlay = ({
  backendProbe,
  modelProgress,
  getDebug,
  videoSize,
  viewportSize,
}: DebugOverlayProps) => {
  const { showDebug, throttleInference, zoomMode } = useSettings();

  const [debug, setDebug] = useState<DebugSnapshot>(getDebug);
  useEffect(() => {
    // The panel renders nothing while showDebug is off, so don't run the
    // readout loop (and its state updates) for a hidden overlay. On enable,
    // the first tick fires within a frame (rAF timestamps exceed the throttle
    // window on any page older than it), so the readout is current
    // immediately rather than stale from the last time it was shown.
    if (!showDebug) {
      return;
    }
    let frame = 0;
    let last = 0;
    const tick = (time: number) => {
      // Throttle to ~8 Hz; the readout is for eyeballing, not smoothness.
      if (time - last > 120) {
        last = time;
        setDebug(getDebug());
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
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
        label="zoom"
        value={`${zoomMode} · ${debug.zoom}x${debug.zoomLocked ? " · locked" : ""}`}
      />
      <Row
        label="pacing"
        value={`${ms(debug.pacingDelayMs)} · ${debug.pacingRule}`}
      />
      <Row label="capture" value={ms(debug.captureMs)} />
      <Row label="preprocess" value={ms(debug.preprocessMs)} />
      <Row label="inference" value={ms(debug.inferenceMs)} />
      <Row label="decode" value={ms(debug.decodeMs)} />
      <Row label="overhead" value={ms(debug.overheadMs)} />
      <Row
        label="detections"
        value={`${debug.shownCount} / ${debug.filteredCount} / ${debug.rawCount}`}
      />
      <Row
        label="bright"
        value={`${(debug.brightFraction * 100).toFixed(2)}%`}
      />
      <Row
        label="viewport"
        value={`${viewportSize.width}x${viewportSize.height}`}
      />
      <Row label="video" value={videoLabel} />
      <Row label="dpr" value={`${window.devicePixelRatio}`} />
      <Row label="model" value={modelPercent} />
    </div>
  );
};
