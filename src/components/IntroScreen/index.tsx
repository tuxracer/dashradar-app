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

/** One compact trust point in the row under the pitch. */
const IntroPoint = ({ label, text }: IntroPointProps) => (
  <div className="flex flex-col items-center gap-0.5">
    <span className="text-xs font-semibold tracking-[0.18em] text-hud-amber">
      {label}
    </span>
    <span className="text-xs font-medium text-white/60">{text}</span>
  </div>
);

type IntroScreenProps = {
  /** Invoked when the start button is tapped; dismisses the intro. */
  onStart: () => void;
};

/**
 * Full-screen first-open intro over the WebGL night-drive scene. Rendered
 * instead of the radar screen until dismissed, so the camera permission
 * prompt fires right after the START tap instead of cold on page load. The
 * model download proceeds underneath in DetectionProvider while the user
 * reads. Content cascades in with a staged reveal (immediate under
 * prefers-reduced-motion). On a desktop the START button is replaced by the
 * share QR code, since the app is built for a phone on a dash: scanning it
 * moves the user to mobile, and a small link below still lets them continue
 * on the desktop.
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

  const rise = "animate-intro-rise motion-reduce:animate-none";

  return (
    <main className="fixed inset-0 overflow-y-auto bg-surface">
      <div className="relative flex min-h-full flex-col items-center justify-center px-8 py-8 landscape:justify-end landscape:pb-[7vh]">
        <RadarBackdrop />
        <IntroScene />
        <div className="flex w-full max-w-xl flex-col items-center gap-4 text-center">
          <span
            className={`${rise} text-[13px] font-semibold tracking-[0.34em] text-white/85 [animation-delay:600ms]`}
          >
            {WORDMARK}
          </span>
          <h1
            className={`${rise} text-4xl font-bold leading-[1.02] tracking-wide text-white [animation-delay:750ms] landscape:text-5xl`}
          >
            SEES POLICE BEFORE YOU DO
          </h1>
          <p
            className={`${rise} max-w-md text-base font-medium leading-snug text-white/70 [animation-delay:900ms]`}
          >
            Mount your phone on the dash. On-device vision watches the road, and
            the meter climbs when a patrol vehicle comes into view.
          </p>
          <div
            className={`${rise} mt-1 flex flex-wrap items-start justify-center gap-x-8 gap-y-3 [animation-delay:1050ms]`}
          >
            <IntroPoint label="ON-DEVICE" text="Runs entirely on your phone" />
            <IntroPoint label="OFFLINE" text="Works with no signal" />
            <IntroPoint
              label="CAMERA"
              text="The feed never leaves your phone"
            />
          </div>
          {desktop ? (
            <div
              className={`${rise} mt-2 flex flex-col items-center gap-3 [animation-delay:1200ms]`}
            >
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
              className={`${rise} mt-3 rounded-full bg-hud-amber px-16 py-4 text-lg font-bold tracking-[0.24em] text-surface shadow-[0_0_44px_rgba(255,179,64,0.35)] [animation-delay:1200ms] active:scale-95`}
            >
              START
            </button>
          )}
        </div>
      </div>
    </main>
  );
};
