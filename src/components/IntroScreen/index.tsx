import { RadarBackdrop } from "@/components/RadarBackdrop";
import { INTRO_SEEN_STORAGE_KEY } from "./consts";

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

/**
 * Animated radar scope: concentric rings, a crosshair, two pulsing blips, and
 * a slow conic-gradient sweep. Purely decorative; the sweep stops under
 * prefers-reduced-motion.
 */
const RadarScope = () => (
  <div className="relative aspect-square w-40 shrink-0 landscape:w-56">
    <div className="absolute inset-0 rounded-full border border-hud-amber/30" />
    <div className="absolute inset-[18%] rounded-full border border-hud-amber/20" />
    <div className="absolute inset-[36%] rounded-full border border-hud-amber/15" />
    <div className="absolute inset-x-0 top-1/2 h-px bg-hud-amber/15" />
    <div className="absolute inset-y-0 left-1/2 w-px bg-hud-amber/15" />
    <div
      className="absolute inset-0 animate-spin rounded-full [animation-duration:4s] motion-reduce:animate-none"
      style={{
        background:
          "conic-gradient(from 0deg, rgba(255,179,64,0.4) 0deg, rgba(255,179,64,0.05) 55deg, transparent 60deg)",
      }}
    />
    <div className="absolute left-[30%] top-[24%] size-2 animate-pulse rounded-full bg-hud-amber shadow-[0_0_8px_#ffb340]" />
    <div className="absolute left-[62%] top-[58%] size-1.5 animate-pulse rounded-full bg-hud-amber/80 shadow-[0_0_6px_#ffb340] [animation-delay:0.8s]" />
  </div>
);

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
 * DetectionProvider while the user reads.
 */
export const IntroScreen = ({ onStart }: IntroScreenProps) => (
  <main className="fixed inset-0 overflow-y-auto bg-surface">
    <div className="relative flex min-h-full flex-col items-center justify-center gap-6 px-8 py-6 landscape:flex-row landscape:gap-14">
      <RadarBackdrop />
      <RadarScope />
      <div className="flex max-w-md flex-col items-center gap-4 text-center landscape:items-start landscape:text-left">
        <span className="text-[13px] font-semibold tracking-[0.34em] text-white/85">
          DASHRADAR
        </span>
        <h1 className="text-3xl font-bold leading-[1.05] tracking-wide text-white/90">
          POLICE DETECTION ON YOUR DASH
        </h1>
        <p className="text-base font-medium leading-snug text-white/70">
          Mount it on the dash, camera facing the road. The signal meter climbs
          when a Las Vegas Metro police vehicle comes into view.
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
        <button
          type="button"
          onClick={onStart}
          className="mt-1 rounded-full bg-hud-amber px-14 py-3.5 text-lg font-bold tracking-[0.24em] text-surface active:scale-95"
        >
          START
        </button>
      </div>
    </div>
  </main>
);
