import { IntroScene } from "@/components/IntroScene";
import { RadarBackdrop } from "@/components/RadarBackdrop";
import { ShareQr } from "@/components/ShareCard";
import { WORDMARK } from "@/lib/branding";
import { isDesktopDevice } from "@/lib/deviceType";
import {
  DESKTOP_CONTINUE_CONFIRM_MESSAGE,
  INTRO_SEEN_STORAGE_KEY,
} from "./consts";

export * from "./consts";

/**
 * True until the intro has been dismissed once. When localStorage is
 * unavailable (private mode / quota) the intro shows again each visit, which
 * beats silently skipping onboarding for a genuine first open.
 */
export const shouldShowIntro = (): boolean => {
  try {
    return window.localStorage.getItem(INTRO_SEEN_STORAGE_KEY) === null;
  } catch {
    return true;
  }
};

/** Persists the dismissal so the intro only ever shows on the first open. */
export const markIntroSeen = () => {
  try {
    window.localStorage.setItem(INTRO_SEEN_STORAGE_KEY, "true");
  } catch {
    // Storage unavailable; the intro will show again next visit.
  }
};

type IntroPointProps = {
  label: string;
  text: string;
};

const IntroPoint = ({ label, text }: IntroPointProps) => (
  <div className="flex items-baseline gap-3 text-left">
    <span className="w-24 shrink-0 text-xs font-semibold tracking-[0.18em] text-hud-amber">
      {label}
    </span>
    <span className="text-sm font-medium leading-snug text-white/70">
      {text}
    </span>
  </div>
);

type IntroScreenProps = {
  /** Invoked when the start button is tapped; dismisses the intro. */
  onStart: () => void;
};

/**
 * Full-screen first-open intro. Rendered instead of the radar screen until
 * dismissed, so the camera permission prompt fires right after the START tap
 * instead of cold on page load. The model download proceeds underneath in
 * DetectionProvider while the user reads. On a desktop the START button is
 * replaced by the share QR code, since the app is built for a phone on a dash:
 * scanning it moves the user to mobile, and a small link below still lets them
 * continue on the desktop.
 */
export const IntroScreen = ({ onStart }: IntroScreenProps) => {
  const desktop = isDesktopDevice();

  // The desktop continue link double-checks intent: the app is built for a
  // phone on a dash, so falling through to the camera flow on a desktop
  // should be a deliberate choice, not a stray click.
  const handleContinueOnDesktop = () => {
    if (window.confirm(DESKTOP_CONTINUE_CONFIRM_MESSAGE)) {
      onStart();
    }
  };

  return (
    <main className="fixed inset-0 overflow-y-auto bg-surface">
      <div className="relative flex min-h-full flex-col items-center justify-center px-8 py-6 portrait:justify-start portrait:pt-[36vh]">
        <RadarBackdrop />
        <IntroScene />
        <div className="relative flex max-w-md flex-col items-center gap-4 text-center landscape:max-w-lg">
          <span className="text-[13px] font-semibold tracking-[0.34em] text-white/85">
            {WORDMARK}
          </span>
          <h1 className="text-3xl font-bold leading-[1.05] tracking-wide text-white/90">
            POLICE DETECTION ON YOUR DASH
          </h1>
          <p className="text-base font-medium leading-snug text-white/70">
            Mount it on the dash, camera facing the road. The signal meter
            climbs when a police vehicle comes into view.
          </p>
          <div className="flex flex-col gap-2">
            <IntroPoint
              label="ON-DEVICE"
              text="Runs entirely on your phone. Nothing leaves the device."
            />
            <IntroPoint
              label="OFFLINE"
              text="Cached after the first load. Works with no signal."
            />
            <IntroPoint
              label="CAMERA"
              text="Access is requested next. The feed stays on your phone."
            />
          </div>
          {desktop ? (
            <div className="mt-1 flex flex-col items-center gap-3 landscape:items-start">
              <p className="text-sm font-semibold tracking-[0.06em] text-white/80">
                Scan with your phone to continue on mobile.
              </p>
              <ShareQr />
              <button
                type="button"
                onClick={handleContinueOnDesktop}
                className="text-sm font-medium text-white/50 underline underline-offset-4 transition-colors hover:text-white/80"
              >
                Continue on this device
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onStart}
              className="mt-1 rounded-full bg-hud-amber px-14 py-3.5 text-lg font-bold tracking-[0.24em] text-surface active:scale-95"
            >
              START
            </button>
          )}
        </div>
      </div>
    </main>
  );
};
