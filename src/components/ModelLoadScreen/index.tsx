import { useEffect, useState } from "react";
import type { ModelProgress } from "@/context/DetectionContext";
import { BYTES_PER_MB, LOADING_INDICATOR_DELAY_MS } from "./consts";

export * from "./consts";

type ModelLoadScreenProps = {
  progress: ModelProgress;
};

const megabytes = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * Full-screen model download indicator, shown only while the weights stream
 * over the network. It distinguishes two phases: DOWNLOADING while bytes are
 * still arriving, and PREPARING (full bar, pulsing) once the download is
 * complete but the ONNX session is still compiling. Without the second label
 * a fast connection finishes the download inside the anti-flash delay and the
 * screen's entire visible life is a bar pegged at 100% under "DOWNLOADING",
 * which reads as a broken progress bar rather than the compile pause it is.
 */
export const ModelLoadScreen = ({ progress }: ModelLoadScreenProps) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setVisible(true),
      LOADING_INDICATOR_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) {
    return null;
  }

  const percent =
    progress.totalBytes > 0
      ? Math.round((progress.loadedBytes / progress.totalBytes) * 100)
      : 0;
  const preparing =
    progress.totalBytes > 0 && progress.loadedBytes >= progress.totalBytes;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface">
      <span className="text-sm font-semibold tracking-[0.3em] text-white/85">
        {preparing ? "PREPARING MODEL" : "DOWNLOADING MODEL"}
      </span>
      <div className="h-1 w-56 overflow-hidden rounded-full bg-white/15">
        <div
          className={`h-full rounded-full bg-hud-amber transition-[width]${
            preparing ? " animate-pulse motion-reduce:animate-none" : ""
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs font-medium tracking-[0.18em] text-white/60">
        {megabytes.format(progress.loadedBytes / BYTES_PER_MB)} MB /{" "}
        {megabytes.format(progress.totalBytes / BYTES_PER_MB)} MB · {percent}%
      </span>
    </div>
  );
};
