import { QR_MODULE_PATH, QR_VIEW_BOX_SIZE, SHARE_URL_LABEL } from "./consts";

export * from "./consts";

/**
 * Static QR code for handing the app to someone else: they point a camera at
 * the phone and {@link SHARE_URL} opens. Near-black modules on a white card so
 * it scans reliably against the dark settings panel, with the URL printed under
 * it for anyone who would rather type it. The QR is a pre-rendered inline SVG
 * (see consts), so it adds no runtime dependency and works fully offline.
 */
export const ShareCard = () => (
  <div className="flex min-h-16 items-center justify-between gap-6 py-4">
    <span className="flex flex-col gap-1">
      <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
        Share dashradar
      </span>
      <span className="text-sm font-medium text-white/45">
        Point a camera to open {SHARE_URL_LABEL}.
      </span>
    </span>
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
  </div>
);
