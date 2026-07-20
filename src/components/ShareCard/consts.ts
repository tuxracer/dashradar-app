/** Canonical public URL, encoded in the share QR code and shown as text. */
export const SHARE_URL = "https://dashradar.app";

/** Bare host shown under the QR; the https scheme is implied. */
export const SHARE_URL_LABEL = "dashradar.app";

/** Side length of the QR grid below, in modules (25 code + a 4-module quiet zone each side). */
export const QR_VIEW_BOX_SIZE = 33;

/**
 * Pre-rendered QR code for SHARE_URL (version 2, error-correction M) as SVG
 * path data on a QR_VIEW_BOX_SIZE grid that already includes the required
 * 4-module quiet zone. Generated once with the `qrcode` package instead of a
 * runtime dependency, so the app stays offline-first and ships no library code
 * for a URL that never changes. To regenerate after changing SHARE_URL:
 *   pnpm dlx qrcode "<url>" -t svg -e M
 * then copy the stroke path's `d` here and update QR_VIEW_BOX_SIZE to the new
 * viewBox size.
 */
export const QR_MODULE_PATH =
  "M4 4.5h7m1 0h4m1 0h1m4 0h7M4 5.5h1m5 0h1m1 0h1m2 0h3m4 0h1m5 0h1M4 6.5h1m1 0h3m1 0h1m2 0h3m1 0h1m1 0h2m1 0h1m1 0h3m1 0h1M4 7.5h1m1 0h3m1 0h1m1 0h2m1 0h6m1 0h1m1 0h3m1 0h1M4 8.5h1m1 0h3m1 0h1m3 0h1m1 0h1m1 0h3m1 0h1m1 0h3m1 0h1M4 9.5h1m5 0h1m2 0h1m3 0h1m4 0h1m5 0h1M4 10.5h7m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h7M12 11.5h3M4 12.5h1m1 0h2m1 0h3m2 0h2m2 0h1m1 0h1m1 0h1m2 0h1m1 0h2M7 13.5h2m4 0h1m1 0h1m2 0h1m1 0h1m2 0h1m3 0h1M6 14.5h1m1 0h1m1 0h1m1 0h3m3 0h1m2 0h1m2 0h1M6 15.5h1m1 0h2m3 0h2m1 0h2m3 0h1m3 0h2M4 16.5h3m2 0h2m2 0h2m1 0h4m1 0h2m1 0h1m1 0h3M5 17.5h1m5 0h1m1 0h4m2 0h2m1 0h3m3 0h1M5 18.5h1m1 0h1m2 0h1m1 0h2m1 0h1m1 0h1m6 0h1m1 0h2M4 19.5h1m1 0h3m2 0h5m3 0h1m1 0h1m1 0h2m3 0h1M9 20.5h2m1 0h1m3 0h1m1 0h1m1 0h9M12 21.5h1m7 0h1m3 0h1m1 0h1m1 0h1M4 22.5h7m1 0h1m4 0h2m1 0h1m1 0h1m1 0h1m1 0h3M4 23.5h1m5 0h1m1 0h1m2 0h1m1 0h4m3 0h1M4 24.5h1m1 0h3m1 0h1m3 0h1m2 0h2m1 0h6m1 0h1M4 25.5h1m1 0h3m1 0h1m1 0h2m5 0h4m1 0h5M4 26.5h1m1 0h3m1 0h1m1 0h2m4 0h1m2 0h2m1 0h1m1 0h2M4 27.5h1m5 0h1m2 0h7m2 0h1m1 0h1m1 0h1M4 28.5h7m1 0h4m6 0h7";
