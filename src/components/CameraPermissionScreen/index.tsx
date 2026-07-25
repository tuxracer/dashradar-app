import { Camera } from "lucide-react";
import { RadarBackdrop } from "@/components/RadarBackdrop";
import { ScopeGlyph } from "@/components/ScopeGlyph";
import { WORDMARK } from "@/lib/branding";
import type { PermissionPoint } from "./consts";
import { CAMERA_PROMPT_STORAGE_KEY, PERMISSION_POINTS } from "./consts";

export * from "./consts";

/**
 * True until the user has accepted the in-app camera permission ask. When
 * localStorage is unavailable (private mode / quota) the ask shows again each
 * visit, which beats silently skipping the explanation before the browser's
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
    <span className="w-24 shrink-0 text-xs font-semibold tracking-[0.18em] text-hud-amber">
      {label}
    </span>
    <span className="text-sm font-medium leading-snug text-white/70">
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
 * Full-screen camera permission ask, shown between the intro and the first
 * getUserMedia call. It explains why the camera is needed before the browser's
 * own permission prompt appears, so that prompt never lands cold: the camera
 * is only requested after the ALLOW CAMERA tap. Laid out like the error
 * screens (scope beside the copy in landscape, stacked in portrait), with the
 * same intact-camera glyph and privacy rows as the PERMISSION_DENIED screen,
 * so accepting and declining stay in one visual language.
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
        <span className="text-[13px] font-semibold tracking-[0.34em] text-white/85">
          {WORDMARK}
        </span>
        <h1 className="text-2xl font-bold leading-[1.05] tracking-wide text-white/90 landscape:text-3xl">
          YOUR CAMERA IS THE DETECTOR
        </h1>
        <p className="text-base font-medium leading-snug text-white/70">
          Patrol vehicles are spotted by watching the road through your rear
          camera. Your browser will ask next. Tap allow to start scanning.
        </p>
        <div className="flex flex-col gap-2">
          {PERMISSION_POINTS.map((point) => (
            <PermissionPointRow key={point.label} {...point} />
          ))}
        </div>
        <button
          type="button"
          className="mt-1 rounded-full bg-hud-amber px-12 py-3.5 text-lg font-bold tracking-[0.24em] text-surface active:scale-95"
          onClick={onAllow}
        >
          ALLOW CAMERA
        </button>
        <button
          type="button"
          onClick={onDecline}
          className="text-sm font-medium text-white/50 underline underline-offset-4 transition-colors hover:text-white/80"
        >
          Not now
        </button>
      </div>
    </div>
  </main>
);
