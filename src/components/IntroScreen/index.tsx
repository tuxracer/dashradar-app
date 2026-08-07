import { IntroScene } from "@/components/IntroScene";
import { RadarBackdrop } from "@/components/RadarBackdrop";
import { ShareTarget } from "@/components/ShareTarget";
import { WORDMARK } from "@/lib/branding";
import { isDesktopDevice } from "@/lib/deviceType";
import {
  DESKTOP_CONTINUE_CONFIRM_MESSAGE,
  INTRO_SEEN_STORAGE_KEY,
  INTRO_VERSION,
} from "./consts";

export * from "./consts";

/**
 * True until the current intro version has been dismissed, so a reworked intro
 * reaches returning users too. Without localStorage it shows every visit, which
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
 * Full-screen first-open intro, rendered instead of the radar screen until
 * dismissed so the camera prompt fires right after the START tap rather than
 * cold on page load. A phone downloads the model underneath while someone reads;
 * a desktop waits. The copy powers on in the same staggered cascade as the
 * permission ask and error screens.
 *
 * On a desktop the START button becomes the `ShareTarget` handoff, since the app
 * is built for a phone on a dash, with a small link below to continue anyway.
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
          {/* Each sentence gets its own line on a narrow phone, where the two
              lines would otherwise wrap mid-clause; wider viewports keep the
              tighter one-sentence-per-line shape. */}
          <div className="flex animate-rise-in flex-col gap-3 text-base font-medium leading-snug text-white/70 [animation-delay:280ms] motion-reduce:animate-none sm:gap-0">
            <p>
              Mount your phone on the dash,
              <br className="sm:hidden" /> camera facing the road.
            </p>
            <p>
              On-device computer vision.
              <br className="sm:hidden" /> Nothing leaves your phone.
            </p>
          </div>
          {desktop ? (
            <div className="mt-1 flex animate-rise-in flex-col items-center gap-4 [animation-delay:360ms] motion-reduce:animate-none">
              <ShareTarget />
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
