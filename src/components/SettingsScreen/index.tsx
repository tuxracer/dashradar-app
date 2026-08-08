import { useEffect, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { DeveloperScreen } from "@/components/DeveloperScreen";
import { ModelScreen } from "@/components/ModelScreen";
import { ShareCard } from "@/components/ShareCard";
import { ToggleRow } from "@/components/ToggleRow";
import { useSettings } from "@/context/SettingsContext";
import { REPO_URL } from "./consts";

export * from "./consts";

/**
 * The screens the panel can hand over to. Held as a stack rather than one
 * value, because the picker is reached through the developer screen and backing
 * out of it has to land there rather than here.
 */
type SubScreen = "model" | "developer";

/**
 * Full-screen settings panel, built for a dash mount in landscape: large rows
 * with big tap targets. Sub-screens render in place of this panel one at a time
 * and the panel owns the stack, so backing out lands on the screen that opened
 * each one. Scanning pauses while it is open.
 */
export const SettingsScreen = () => {
  const {
    settingsOpen,
    closeSettings,
    radarAudio,
    toggleRadarAudio,
    detectionImage,
    toggleDetectionImage,
  } = useSettings();
  const [stack, setStack] = useState<readonly SubScreen[]>([]);
  const top = stack[stack.length - 1];

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      // One screen at a time, which is what a stack makes someone expect and also
      // what keeps it from outliving the panel: this component never unmounts, so
      // closing settings from a sub-screen would reopen onto that sub-screen.
      if (stack.length > 0) {
        setStack((previous) => previous.slice(0, -1));
        return;
      }
      closeSettings();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [settingsOpen, closeSettings, stack]);

  if (!settingsOpen) {
    return null;
  }

  // Rendered instead of the panel rather than over it, so there is one screen
  // on the glass at a time. settingsOpen stays true throughout, which is what
  // keeps the detection pump paused while a sub-screen is up.
  const pop = () => setStack((previous) => previous.slice(0, -1));
  if (top === "model") {
    return <ModelScreen onClose={pop} />;
  }
  if (top === "developer") {
    return (
      <DeveloperScreen
        onClose={pop}
        onOpenModel={() => setStack((previous) => [...previous, "model"])}
      />
    );
  }

  const versionLabel = __COMMIT_SHA__;

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
          <ToggleRow
            label="Audio alerts"
            description="Beeps faster as the signal climbs."
            on={radarAudio}
            onToggle={toggleRadarAudio}
          />

          <ToggleRow
            label="Detection image"
            description="Shows a picture of what was detected."
            on={detectionImage}
            onToggle={toggleDetectionImage}
          />

          <button
            type="button"
            data-testid="open-developer-screen"
            onClick={() => setStack(["developer"])}
            className="flex min-h-16 items-center justify-between gap-6 py-4 text-left"
          >
            <span className="flex flex-col gap-1">
              <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
                Developer options
              </span>
              <span className="text-sm font-medium text-white/45">
                Tools for working on the app.
              </span>
            </span>
            <ChevronRight
              className="h-5 w-5 shrink-0 text-white/60"
              strokeWidth={2}
            />
          </button>

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
                No images leave the device.
              </span>
            </span>
            <span className="text-base font-semibold tracking-[0.12em] text-white/60">
              {versionLabel} ↗
            </span>
          </a>

          <ShareCard />
        </div>
      </div>
    </div>
  );
};
