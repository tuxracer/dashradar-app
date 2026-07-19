import { SettingsMenu } from "@/components/SettingsMenu";
import type { DetectionBackend } from "@/workers/detection/types";

type StatusBarProps = {
  backend: DetectionBackend | undefined;
  fps: number;
};

export const StatusBar = ({ backend, fps }: StatusBarProps) => {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] flex items-center justify-between px-4">
      <span className="text-[13px] font-semibold tracking-[0.34em] text-white/85">
        DASHRADAR
      </span>
      <div className="flex items-center gap-3">
        {backend && (
          <span className="text-xs font-semibold tracking-[0.18em] text-white/60">
            {backend === "webgpu" ? "GPU" : "CPU"} · {fps} FPS
          </span>
        )}
        <SettingsMenu />
      </div>
    </div>
  );
};
