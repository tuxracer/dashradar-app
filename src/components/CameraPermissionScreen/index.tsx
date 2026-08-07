import { Camera } from "lucide-react";
import { RadarBackdrop } from "@/components/RadarBackdrop";
import { ScopeGlyph } from "@/components/ScopeGlyph";
import type { PermissionPoint } from "./consts";
import { CAMERA_PROMPT_STORAGE_KEY, PERMISSION_POINTS } from "./consts";

export * from "./consts";

/**
 * True until the in-app camera ask has been accepted. Without localStorage it
 * shows every visit, which beats skipping the explanation before the browser's
 * own prompt.
 */
export const shouldShowCameraPrompt = (): boolean => {
  try {
    return window.localStorage.getItem(CAMERA_PROMPT_STORAGE_KEY) === null;
  } catch {
    return true;
  }
};

/** Persists the acceptance so the permission ask never shows again. */
export const markCameraPromptAccepted = () => {
  try {
    window.localStorage.setItem(CAMERA_PROMPT_STORAGE_KEY, "true");
  } catch {
    // Storage unavailable; the ask will show again next visit.
  }
};

const PermissionPointRow = ({ label, text }: PermissionPoint) => (
  <div className="flex items-baseline gap-3 text-left">
    <span className="shrink-0 text-xs font-semibold tracking-[0.18em] text-hud-amber">
      {label}
    </span>
    <span className="whitespace-pre-line text-sm font-medium leading-snug text-white/70">
      {text}
    </span>
  </div>
);

type CameraPermissionScreenProps = {
  /** Invoked when the allow button is tapped; the caller then mounts the camera, which fires the browser's own prompt. */
  onAllow: () => void;
  /** Invoked when the not-now link is tapped; the caller shows the camera access denied screen. */
  onDecline: () => void;
};

/**
 * Full-screen camera ask, between the intro and the first getUserMedia call, so
 * the browser's own prompt never lands cold. Laid out like the error screens with
 * the intact-camera glyph, so accepting and declining stay in one visual
 * language. The copy is kept to a glance, since the intro one tap earlier already
 * introduced the app: only why the camera is needed and that it stays private.
 */
export const CameraPermissionScreen = ({
  onAllow,
  onDecline,
}: CameraPermissionScreenProps) => (
  <main className="fixed inset-0 overflow-y-auto bg-surface">
    <div className="relative flex min-h-full flex-col items-center justify-center gap-6 px-8 py-6 landscape:flex-row landscape:gap-12">
      <RadarBackdrop />
      <ScopeGlyph icon={Camera} />
      <div className="flex max-w-md flex-col items-center gap-4 text-center landscape:items-start landscape:text-left">
        <h1 className="animate-rise-in text-2xl font-bold leading-[1.05] tracking-wide text-white/90 [animation-delay:120ms] motion-reduce:animate-none landscape:text-3xl">
          YOUR CAMERA IS THE DETECTOR
        </h1>
        <p className="animate-rise-in text-base font-medium leading-snug text-white/70 [animation-delay:200ms] motion-reduce:animate-none">
          It watches the road through your rear camera to spot patrol vehicles.
        </p>
        <div className="flex animate-rise-in flex-col gap-2 [animation-delay:280ms] motion-reduce:animate-none">
          {PERMISSION_POINTS.map((point) => (
            <PermissionPointRow key={point.label} {...point} />
          ))}
        </div>
        <button
          type="button"
          className="mt-1 animate-rise-in rounded-full bg-hud-amber px-12 py-3.5 text-lg font-bold tracking-[0.24em] text-surface [animation-delay:360ms] [animation-duration:0.6s] active:scale-95 motion-reduce:animate-none"
          onClick={onAllow}
        >
          ALLOW CAMERA
        </button>
        <button
          type="button"
          onClick={onDecline}
          className="animate-rise-in text-sm font-medium text-white/50 underline underline-offset-4 transition-colors [animation-delay:440ms] hover:text-white/80 motion-reduce:animate-none"
        >
          Not now
        </button>
      </div>
    </div>
  </main>
);
