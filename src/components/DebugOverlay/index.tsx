import { useEffect, useState } from "react";
import { useSettings } from "@/context/SettingsContext";
import type {
  DebugSnapshot,
  MainThreadWebGpu,
  ModelProgress,
} from "@/context/DetectionContext";
import type { Size } from "@/lib/detection";
import { orientationDeltaToPixels, type YawPitch } from "@/lib/motionSensor";
import type { BackendProbe, DetectionBackend } from "@/workers/detection/types";

/** Props for DebugOverlay. Data is passed in so it renders without the worker. */
type DebugOverlayProps = {
  backend: DetectionBackend | undefined;
  backendProbe: BackendProbe | undefined;
  mainThreadWebGpu: MainThreadWebGpu | undefined;
  fps: number;
  modelProgress: ModelProgress;
  debug: DebugSnapshot;
  videoSize: Size | undefined;
  viewportSize: Size;
  /** Live yaw/pitch delta since the displayed detection was captured. */
  getMotionDelta: () => YawPitch;
};

/** Compact per-stage summary of the WebGPU probe, e.g. "gpu·adp·dev·f16". */
const probeStages = (probe: BackendProbe): string => {
  const stage = (ok: boolean, label: string): string =>
    ok ? label : `no-${label}`;
  return [
    stage(probe.workerGpu, "gpu"),
    stage(probe.adapter, "adp"),
    stage(probe.device, "dev"),
    stage(probe.shaderF16, "f16"),
  ].join(" ");
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
  backendProbe,
  mainThreadWebGpu,
  fps,
  modelProgress,
  debug,
  videoSize,
  viewportSize,
  getMotionDelta,
}: DebugOverlayProps) => {
  const { showDebug } = useSettings();

  const [motion, setMotion] = useState<YawPitch>({ yaw: 0, pitch: 0 });
  useEffect(() => {
    let frame = 0;
    let last = 0;
    const tick = (time: number) => {
      // Throttle to ~8 Hz; the readout is for eyeballing, not smoothness.
      if (time - last > 120) {
        last = time;
        setMotion(getMotionDelta());
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [getMotionDelta]);

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
  const toDeg = (rad: number): number => (rad * 180) / Math.PI;
  const offset =
    videoSize !== undefined
      ? orientationDeltaToPixels(motion, videoSize, viewportSize)
      : { dx: 0, dy: 0 };

  return (
    <div className="pointer-events-none absolute left-4 top-[max(3.5rem,calc(env(safe-area-inset-top)+2.75rem))] z-20 min-w-40 rounded-lg border border-white/15 bg-black/70 px-3 py-2 font-mono text-[11px] leading-relaxed text-white/85 backdrop-blur-sm">
      <div className="mb-1 font-semibold tracking-[0.2em] text-white/60">
        DEBUG
      </div>
      <Row label="engine" value={`${backendLabel} · ${fps} FPS`} />
      {backendProbe && (
        <Row label="wgpu probe" value={probeStages(backendProbe)} />
      )}
      <Row label="wgpu main" value={mainThreadWebGpu ?? "probing"} />
      {backendProbe && (
        <Row
          label="wasm"
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
      <Row label="round-trip" value={ms(debug.roundTripMs)} />
      <Row label="capture" value={ms(debug.captureMs)} />
      <Row label="preprocess" value={ms(debug.preprocessMs)} />
      <Row label="inference" value={ms(debug.inferenceMs)} />
      <Row label="decode" value={ms(debug.decodeMs)} />
      <Row label="overhead" value={ms(debug.overheadMs)} />
      <Row
        label="detections"
        value={`${debug.filteredCount} / ${debug.rawCount}`}
      />
      <Row
        label="motion"
        value={`${toDeg(motion.yaw).toFixed(1)}° / ${toDeg(motion.pitch).toFixed(1)}°`}
      />
      <Row
        label="offset"
        value={`${Math.round(offset.dx)} / ${Math.round(offset.dy)} px`}
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
