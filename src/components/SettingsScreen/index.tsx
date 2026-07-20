import { useEffect } from "react";
import { X } from "lucide-react";
import { useSettings } from "@/context/SettingsContext";
import type { DetectionBackend } from "@/workers/detection/types";
import { MODEL_SLUG, MODEL_URL, REPO_URL } from "./consts";

export * from "./consts";

/** Props for SettingsScreen. */
type SettingsScreenProps = {
  backend: DetectionBackend | undefined;
  fps: number;
};

/**
 * Full-screen settings panel built for driver-first use on a dash mount, in
 * landscape. Renders nothing until the panel is opened. Large, full-width rows
 * with big tap targets: Video feed and Debug overlay toggles plus read-only
 * Detection engine, Model, and About rows. Closes on the large close button or
 * Escape. Detection keeps running underneath while this is open. Reads
 * backend/fps as props (the same way StatusBar used to) so it stays testable
 * without the worker.
 */
export const SettingsScreen = ({ backend, fps }: SettingsScreenProps) => {
  const {
    settingsOpen,
    closeSettings,
    showVideo,
    toggleShowVideo,
    showDebug,
    toggleShowDebug,
  } = useSettings();

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeSettings();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [settingsOpen, closeSettings]);

  if (!settingsOpen) {
    return null;
  }

  const engineLabel = backend
    ? `${backend === "webgpu" ? "GPU" : "CPU"} · ${fps} FPS`
    : "Starting…";

  const versionLabel =
    __COMMIT_SHA__ === "unknown"
      ? `v${__APP_VERSION__}`
      : `v${__APP_VERSION__} · ${__COMMIT_SHA__}`;

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-surface/95 backdrop-blur-md">
      <div className="flex items-center justify-between px-6 pb-4 pt-[max(1.5rem,env(safe-area-inset-top))]">
        <span className="text-base font-semibold tracking-[0.34em] text-white/85">
          SETTINGS
        </span>
        <button
          type="button"
          onClick={closeSettings}
          className="flex h-12 w-12 items-center justify-center rounded-full text-white/70 transition-colors hover:text-white/90"
        >
          <X className="h-7 w-7" strokeWidth={2} />
          <span className="sr-only">Close settings</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex w-full max-w-2xl flex-col divide-y divide-white/10">
          <button
            type="button"
            onClick={toggleShowVideo}
            className="flex min-h-16 items-center justify-between gap-6 py-4 text-left"
          >
            <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
              Video feed
            </span>
            <span
              className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors ${
                showVideo ? "bg-hud-amber" : "bg-white/25"
              }`}
            >
              <span
                className={`inline-block h-6 w-6 rounded-full bg-surface transition-transform ${
                  showVideo ? "translate-x-[1.75rem]" : "translate-x-[0.25rem]"
                }`}
              />
            </span>
          </button>

          <button
            type="button"
            onClick={toggleShowDebug}
            className="flex min-h-16 items-center justify-between gap-6 py-4 text-left"
          >
            <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
              Debug overlay
            </span>
            <span
              className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors ${
                showDebug ? "bg-hud-amber" : "bg-white/25"
              }`}
            >
              <span
                className={`inline-block h-6 w-6 rounded-full bg-surface transition-transform ${
                  showDebug ? "translate-x-[1.75rem]" : "translate-x-[0.25rem]"
                }`}
              />
            </span>
          </button>

          <div className="flex min-h-16 items-center justify-between gap-6 py-4">
            <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
              Detection engine
            </span>
            <span className="text-base font-semibold tracking-[0.12em] text-white/60">
              {engineLabel}
            </span>
          </div>

          <a
            href={MODEL_URL}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-16 items-center justify-between gap-6 py-4"
          >
            <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
              Model
            </span>
            <span className="text-base font-semibold tracking-[0.04em] text-white/60">
              {MODEL_SLUG} ↗
            </span>
          </a>

          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-16 items-center justify-between gap-6 py-4"
          >
            <span className="flex flex-col gap-1">
              <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
                About
              </span>
              <span className="text-sm font-medium text-white/45">
                No data leaves the device.
              </span>
            </span>
            <span className="text-base font-semibold tracking-[0.12em] text-white/60">
              {versionLabel} ↗
            </span>
          </a>
        </div>
      </div>
    </div>
  );
};
