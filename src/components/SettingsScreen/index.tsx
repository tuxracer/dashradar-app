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
 * Which screen the panel has handed over to, if any. One value rather than a
 * flag each, because only one can be on the glass at a time and the Escape
 * handler backs out of whichever it is.
 */
type SubScreen = "model" | "developer";

/**
 * Full-screen settings panel built for driver-first use on a dash mount, in
 * landscape. Renders nothing until the panel is opened. Large, full-width rows
 * with big tap targets: the Audio alerts and Detection image toggles, the
 * Detection model row, the Developer options row, and the About row.
 * Two rows lead somewhere rather than doing something: Detection model opens
 * ModelScreen, which owns picking the model and applying the choice, and
 * Developer options opens DeveloperScreen, which owns the master switch and
 * everything behind it. Both render in place of this panel.
 * Closes on the large close button or Escape, and Escape backs out of a
 * sub-screen first rather than dismissing both. While it is open the detection
 * pump is paused (DetectionContext watches `settingsOpen`) and resumes on
 * close.
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
  const [subScreen, setSubScreen] = useState<SubScreen | undefined>(undefined);

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      // Backs out one screen at a time rather than dismissing both at once,
      // which is what a sub-screen makes someone expect and is also what keeps
      // subScreen from outliving the panel. This component is rendered
      // unconditionally and only returns null while the panel is closed, so it
      // never unmounts: closing settings straight from a sub-screen would
      // leave subScreen set and reopen settings onto it.
      if (subScreen) {
        setSubScreen(undefined);
        return;
      }
      closeSettings();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [settingsOpen, closeSettings, subScreen]);

  if (!settingsOpen) {
    return null;
  }

  // Rendered instead of the panel rather than over it, so there is one screen
  // on the glass at a time. settingsOpen stays true throughout, which is what
  // keeps the detection pump paused while a sub-screen is up.
  if (subScreen === "model") {
    return <ModelScreen onClose={() => setSubScreen(undefined)} />;
  }
  if (subScreen === "developer") {
    return <DeveloperScreen onClose={() => setSubScreen(undefined)} />;
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
            data-testid="open-model-screen"
            onClick={() => setSubScreen("model")}
            className="flex min-h-16 items-center justify-between gap-6 py-4 text-left"
          >
            <span className="flex flex-col gap-1">
              <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
                Detection model
              </span>
              <span className="text-sm font-medium text-white/45">
                Sets what the app looks for on the road.
              </span>
            </span>
            {/* No model name here. A checkpoint's name is a repo slug, far too
                long for what is left of a settings row, and it wrapped over
                two lines to say something the screen behind this row says
                properly. */}
            <ChevronRight
              className="h-5 w-5 shrink-0 text-white/60"
              strokeWidth={2}
            />
          </button>

          <button
            type="button"
            data-testid="open-developer-screen"
            onClick={() => setSubScreen("developer")}
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
