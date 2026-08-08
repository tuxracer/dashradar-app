import type { LucideIcon } from "lucide-react";
import { Camera, CameraOff, CloudOff, TriangleAlert } from "lucide-react";
import { RadarBackdrop } from "@/components/RadarBackdrop";
import { ScopeGlyph } from "@/components/ScopeGlyph";
import { WORDMARK } from "@/lib/branding";
import type { AppErrorCode, ErrorPoint } from "./consts";
import { ERROR_COPY } from "./consts";

export * from "./consts";

/**
 * Glyph shown inside the scope rings for each error code. The permission ask
 * gets an intact camera (an invitation to grant access, not a broken state);
 * camera failures get the blocked camera, the model download a blocked cloud,
 * and worker failures a warning triangle.
 */
const ERROR_ICON: Readonly<Record<AppErrorCode, LucideIcon>> = {
  PERMISSION_DENIED: Camera,
  NO_CAMERA: CameraOff,
  CAMERA_IN_USE: CameraOff,
  UNSUPPORTED: CameraOff,
  MODEL_LOAD_FAILED: CloudOff,
  INFERENCE_FAILED: TriangleAlert,
  GPU_DEVICE_LOST: TriangleAlert,
  WORKER_CRASHED: TriangleAlert,
};

const ErrorPointRow = ({ label, text }: ErrorPoint) => (
  <div className="flex items-baseline gap-3 text-left">
    <span className="w-24 shrink-0 text-xs font-semibold tracking-[0.18em] text-hud-amber">
      {label}
    </span>
    <span className="text-sm font-medium leading-snug text-white/70">
      {text}
    </span>
  </div>
);

type ErrorScreenProps = {
  code: AppErrorCode;
  /**
   * Optional recovery action beside TRY AGAIN, for failures that have a
   * better answer than reloading into the same state (today: a selected
   * model that will not load, revertable to the default).
   */
  action?: { label: string; onClick: () => void };
};

/**
 * Full-screen error panel keyed by error code. Laid out like the intro so
 * failures stay in the app's visual language instead of reading as a wall of
 * text, and enters in the same staggered cascade as the rest of the family.
 */
export const ErrorScreen = ({ code, action }: ErrorScreenProps) => {
  const { title, body, points } = ERROR_COPY[code];
  return (
    <main className="fixed inset-0 overflow-y-auto bg-surface">
      <div className="relative flex min-h-full flex-col items-center justify-center gap-6 px-8 py-6 landscape:flex-row landscape:gap-12">
        <RadarBackdrop />
        <ScopeGlyph icon={ERROR_ICON[code]} />
        <div className="flex max-w-md flex-col items-center gap-4 text-center landscape:items-start landscape:text-left">
          <span className="animate-rise-in text-[13px] font-semibold tracking-[0.34em] text-white/85 [animation-delay:120ms] motion-reduce:animate-none">
            {WORDMARK}
          </span>
          <h1 className="animate-rise-in text-2xl font-bold leading-[1.05] tracking-wide text-white/90 [animation-delay:200ms] motion-reduce:animate-none landscape:text-3xl">
            {title}
          </h1>
          <p
            data-testid="error-message"
            className="animate-rise-in text-base font-medium leading-snug text-white/70 [animation-delay:280ms] motion-reduce:animate-none"
          >
            {body}
          </p>
          {points && (
            <div className="flex animate-rise-in flex-col gap-2 [animation-delay:360ms] motion-reduce:animate-none">
              {points.map((point) => (
                <ErrorPointRow key={point.label} {...point} />
              ))}
            </div>
          )}
          {action && (
            <button
              className="mt-1 animate-rise-in rounded-full border border-white/25 px-12 py-3.5 text-lg font-bold tracking-[0.24em] text-white/85 [animation-delay:440ms] [animation-duration:0.6s] active:scale-95 motion-reduce:animate-none"
              onClick={action.onClick}
            >
              {action.label}
            </button>
          )}
          <button
            className="mt-1 animate-rise-in rounded-full bg-hud-amber px-12 py-3.5 text-lg font-bold tracking-[0.24em] text-surface [animation-delay:440ms] [animation-duration:0.6s] active:scale-95 motion-reduce:animate-none"
            onClick={() => window.location.reload()}
          >
            TRY AGAIN
          </button>
        </div>
      </div>
    </main>
  );
};
