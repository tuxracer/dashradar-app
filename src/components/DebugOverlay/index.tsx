import { useSettings } from "@/context/SettingsContext";
import type { DebugSnapshot, ModelProgress } from "@/context/DetectionContext";
import type { Size } from "@/lib/detection";
import type { DetectionBackend } from "@/workers/detection/types";

/** Props for DebugOverlay. Data is passed in so it renders without the worker. */
type DebugOverlayProps = {
  backend: DetectionBackend | undefined;
  fps: number;
  modelProgress: ModelProgress;
  debug: DebugSnapshot;
  videoSize: Size | undefined;
  viewportSize: Size;
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
 * it never intercepts taps meant for the HUD. Data comes in as props (backend,
 * fps, model progress, the per-frame debug snapshot, and the current sizes) so
 * the panel stays testable without the detection worker.
 */
export const DebugOverlay = ({
  backend,
  fps,
  modelProgress,
  debug,
  videoSize,
  viewportSize,
}: DebugOverlayProps) => {
  const { showDebug } = useSettings();
  if (!showDebug) {
    return null;
  }

  const backendLabel = backend
    ? backend === "webgpu"
      ? "GPU"
      : "CPU"
    : "starting";
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
      <Row label="engine" value={`${backendLabel} · ${fps} FPS`} />
      <Row label="round-trip" value={ms(debug.roundTripMs)} />
      <Row label="capture" value={ms(debug.captureMs)} />
      <Row label="preprocess" value={ms(debug.preprocessMs)} />
      <Row label="inference" value={ms(debug.inferenceMs)} />
      <Row label="decode" value={ms(debug.decodeMs)} />
      <Row label="in-flight" value={`${debug.inFlight}`} />
      <Row
        label="detections"
        value={`${debug.filteredCount} / ${debug.rawCount}`}
      />
      <Row
        label="viewport"
        value={`${viewportSize.width}x${viewportSize.height}`}
      />
      <Row label="video" value={videoLabel} />
      <Row label="dpr" value={`${window.devicePixelRatio}`} />
      <Row label="webgpu" value={"gpu" in navigator ? "yes" : "no"} />
      <Row label="model" value={modelPercent} />
    </div>
  );
};
