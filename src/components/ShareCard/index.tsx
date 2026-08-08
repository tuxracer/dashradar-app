import { track } from "@vercel/analytics";
import { Share } from "lucide-react";
import {
  QR_MODULE_PATH,
  QR_VIEW_BOX_SIZE,
  SHARE_URL,
  SHARE_URL_LABEL,
} from "./consts";

export * from "./consts";

/**
 * The scannable QR card: {@link SHARE_URL} as a pre-rendered inline SVG, dark
 * modules on a white card so it scans reliably against a dark backdrop.
 */
export const ShareQr = () => (
  <div className="flex shrink-0 flex-col items-center gap-2 rounded-2xl bg-white p-3">
    <svg
      viewBox={`0 0 ${QR_VIEW_BOX_SIZE} ${QR_VIEW_BOX_SIZE}`}
      shapeRendering="crispEdges"
      className="h-32 w-32"
    >
      <path stroke="#0b0a10" strokeWidth={1} d={QR_MODULE_PATH} />
    </svg>
    <span className="text-xs font-semibold tracking-[0.08em] text-surface/70">
      {SHARE_URL_LABEL}
    </span>
  </div>
);

/** Whether the native share sheet is available, for callers offering a share. */
export const canShareApp = (): boolean => typeof navigator.share === "function";

/**
 * Open the native share sheet with {@link SHARE_URL}. Shared by the settings
 * share row and the unsupported-device screen so both report the same event
 * and swallow the same rejection; only the button styling differs between
 * them, so the action is extracted rather than the whole control.
 */
export const shareApp = () => {
  track("share_click");
  // Dismissing the native share sheet rejects with AbortError; there is
  // nothing to recover from, so swallow the rejection.
  navigator.share({ url: SHARE_URL }).catch(() => undefined);
};

/**
 * Share row for handing the app to someone else: the QR code, plus a SHARE button
 * wherever the Web Share API exists.
 */
export const ShareCard = () => {
  const supportsShare = canShareApp();

  return (
    <div className="flex min-h-16 items-center justify-between gap-6 py-4">
      <span className="flex flex-col gap-1">
        <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
          Share dashradar
        </span>
        <span className="text-sm font-medium text-white/45">
          Point a camera at the QR code to open {SHARE_URL_LABEL}.
        </span>
        {supportsShare && (
          <button
            type="button"
            onClick={shareApp}
            className="mt-3 inline-flex min-h-14 items-center justify-center gap-3 self-start rounded-2xl bg-hud-amber px-8 text-base font-semibold tracking-[0.18em] text-surface transition-opacity hover:opacity-90"
          >
            <Share className="h-5 w-5" strokeWidth={2.25} />
            SHARE
          </button>
        )}
      </span>
      <ShareQr />
    </div>
  );
};
