import type { LucideIcon } from "lucide-react";
import { Camera, CameraOff, CloudOff, TriangleAlert } from "lucide-react";
import { RadarBackdrop } from "@/components/RadarBackdrop";
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
  WORKER_CRASHED: TriangleAlert,
  CAMERA_STALLED: CameraOff,
};

/**
 * The error glyph centered in static radar-scope rings, echoing the intro's
 * animated scope so the error state still reads as part of the instrument.
 * The outer ring pulses gently; purely decorative.
 */
const ErrorScope = ({ icon: Icon }: { icon: LucideIcon }) => (
  <div className="relative flex aspect-square w-36 shrink-0 items-center justify-center landscape:w-44">
    <div className="absolute inset-0 animate-pulse rounded-full border border-hud-amber/30 motion-reduce:animate-none" />
    <div className="absolute inset-[14%] rounded-full border border-hud-amber/20" />
    <div className="absolute inset-x-0 top-1/2 h-px bg-hud-amber/10" />
    <div className="absolute inset-y-0 left-1/2 w-px bg-hud-amber/10" />
    <Icon
      className="relative h-14 w-14 text-hud-amber landscape:h-16 landscape:w-16"
      strokeWidth={1.25}
      aria-hidden
    />
  </div>
);

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
};

/**
 * Full-screen error panel keyed by error code: scope-ringed glyph, headline,
 * body copy, optional reassurance rows, and a reload button. Laid out like the
 * intro (scope beside the copy in landscape, stacked in portrait) so failures
 * stay in the app's visual language instead of reading as a wall of text.
 */
export const ErrorScreen = ({ code }: ErrorScreenProps) => {
  const { title, body, points } = ERROR_COPY[code];
  return (
    <main className="fixed inset-0 overflow-y-auto bg-surface">
      <div className="relative flex min-h-full flex-col items-center justify-center gap-6 px-8 py-6 landscape:flex-row landscape:gap-12">
        <RadarBackdrop />
        <ErrorScope icon={ERROR_ICON[code]} />
        <div className="flex max-w-md flex-col items-center gap-4 text-center landscape:items-start landscape:text-left">
          <span className="text-[13px] font-semibold tracking-[0.34em] text-white/85">
            {WORDMARK}
          </span>
          <h1 className="text-2xl font-bold leading-[1.05] tracking-wide text-white/90 landscape:text-3xl">
            {title}
          </h1>
          <p
            data-testid="error-message"
            className="text-base font-medium leading-snug text-white/70"
          >
            {body}
          </p>
          {points && (
            <div className="flex flex-col gap-2">
              {points.map((point) => (
                <ErrorPointRow key={point.label} {...point} />
              ))}
            </div>
          )}
          <button
            className="mt-1 rounded-full bg-hud-amber px-12 py-3.5 text-lg font-bold tracking-[0.24em] text-surface active:scale-95"
            onClick={() => window.location.reload()}
          >
            TRY AGAIN
          </button>
        </div>
      </div>
    </main>
  );
};
