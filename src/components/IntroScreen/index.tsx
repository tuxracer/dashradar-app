import { IntroScene } from "@/components/IntroScene";
import { RadarBackdrop } from "@/components/RadarBackdrop";
import { ShareQr } from "@/components/ShareCard";
import { WORDMARK } from "@/lib/branding";
import { isDesktopDevice } from "@/lib/deviceType";
import {
  DESKTOP_CONTINUE_CONFIRM_MESSAGE,
  INTRO_SEEN_STORAGE_KEY,
  INTRO_VERSION,
} from "./consts";

export * from "./consts";

/**
 * True until the current intro version has been dismissed. A stored value that
 * is missing, not a number, or older than INTRO_VERSION shows the intro again,
 * so a reworked intro reaches returning users too. When localStorage is
 * unavailable (private mode / quota) the intro shows again each visit, which
 * beats silently skipping onboarding for a genuine first open.
 */
export const shouldShowIntro = (): boolean => {
  try {
    const seen = Number(window.localStorage.getItem(INTRO_SEEN_STORAGE_KEY));
    return !Number.isFinite(seen) || seen < INTRO_VERSION;
  } catch {
    return true;
  }
};

/** Persists the dismissal of the current intro version. */
export const markIntroSeen = () => {
  try {
    window.localStorage.setItem(INTRO_SEEN_STORAGE_KEY, String(INTRO_VERSION));
  } catch {
    // Storage unavailable; the intro will show again next visit.
  }
};

type IntroScreenProps = {
  /** Invoked when the start button is tapped; dismisses the intro. */
  onStart: () => void;
};

/**
 * Full-screen first-open intro. Rendered instead of the radar screen until
 * dismissed, so the camera permission prompt fires right after the START tap
 * instead of cold on page load. The model download proceeds underneath in
 * DetectionProvider while the user reads. The copy powers on in the same
 * one-shot staggered cascade as the permission ask and error screens, so the
 * whole panel family enters the same way. On a desktop the START button is
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
      <div className="relative flex min-h-full flex-col items-center justify-center px-8 py-6">
        <RadarBackdrop />
        <IntroScene />
        <div className="relative flex max-w-md flex-col items-center gap-4 text-center landscape:max-w-lg">
          <span className="animate-rise-in text-[13px] font-semibold tracking-[0.34em] text-white/85 [animation-delay:120ms] motion-reduce:animate-none">
            {WORDMARK}
          </span>
          <h1 className="animate-rise-in text-3xl font-bold leading-[1.05] tracking-wide text-white/90 [animation-delay:200ms] motion-reduce:animate-none">
            <span>POLICE DETECTION</span>{" "}
            <span className="block">ON YOUR DASH</span>
          </h1>
          <p className="animate-rise-in text-base font-medium leading-snug text-white/70 [animation-delay:280ms] motion-reduce:animate-none">
            On-device computer vision. Nothing leaves your phone.
          </p>
          {desktop ? (
            <div className="mt-1 flex animate-rise-in flex-col items-center gap-3 [animation-delay:360ms] motion-reduce:animate-none">
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
              className="mt-1 animate-rise-in rounded-full bg-hud-amber px-14 py-3.5 text-lg font-bold tracking-[0.24em] text-surface [animation-delay:360ms] [animation-duration:0.6s] active:scale-95 motion-reduce:animate-none"
            >
              START
            </button>
          )}
        </div>
      </div>
    </main>
  );
};
