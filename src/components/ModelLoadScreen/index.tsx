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

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface">
      <span className="text-sm font-semibold tracking-[0.3em] text-white/85">
        DOWNLOADING MODEL
      </span>
      <div className="h-1 w-56 overflow-hidden rounded-full bg-white/15">
        <div
          className="h-full rounded-full bg-hud-amber transition-[width]"
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
