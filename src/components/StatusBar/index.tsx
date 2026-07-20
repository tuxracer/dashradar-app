import { SettingsButton } from "@/components/SettingsButton";

/**
 * Top bar over the radar: the DASHRADAR wordmark on the left and the settings
 * gear on the right. The engine/FPS readout now lives in the full-screen
 * settings panel, keeping this bar minimal and glanceable for a driver.
 * pointer-events are disabled on the container so the video and HUD underneath
 * stay interactive; SettingsButton re-enables them for the gear itself.
 */
export const StatusBar = () => {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] flex items-center justify-between px-4">
      <span className="text-[13px] font-semibold tracking-[0.34em] text-white/85">
        DASHRADAR
      </span>
      <SettingsButton />
    </div>
  );
};
