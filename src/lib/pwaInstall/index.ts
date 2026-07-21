import { track } from "@vercel/analytics";
import { isBoolean } from "remeda";
import { PWA_INSTALL_TRACKED_KEY } from "./consts";

export * from "./consts";

/**
 * True when the page is running as an installed PWA rather than a browser tab.
 * `display-mode: standalone` (the app's manifest display mode) covers
 * Chromium/Android installs; `navigator.standalone` is the legacy iOS Safari
 * boolean Apple never replaced with the standard media query. Returns false
 * when `matchMedia` is unavailable, treating the page as a plain browser tab.
 */
export const isStandalone = (): boolean => {
  const displayStandalone =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  // navigator.standalone is a non-standard, iOS-only property; read it without
  // asserting a type and validate the runtime value with a guard.
  const iosStandalone: unknown = Reflect.get(window.navigator, "standalone");
  return displayStandalone || (isBoolean(iosStandalone) && iosStandalone);
};

/** Send the `pwa_installed` event once, guarded by the localStorage flag. */
const reportInstallOnce = (): void => {
  try {
    if (window.localStorage.getItem(PWA_INSTALL_TRACKED_KEY) !== null) {
      return;
    }
    track("pwa_installed");
    window.localStorage.setItem(PWA_INSTALL_TRACKED_KEY, "1");
  } catch {
    // Storage unavailable (private mode / quota). Report the install anyway on
    // the standalone-launch path so the event is not lost; without the flag it
    // may re-fire on a later launch, which is preferable to never counting it.
    track("pwa_installed");
  }
};

/**
 * Report a one-time anonymous `pwa_installed` analytics event. Two paths feed
 * it, deduped by the same flag: Chromium fires `appinstalled` at the true
 * install moment, while iOS (where Safari implements no `appinstalled` and
 * every install is a manual Add to Home Screen) is caught on the first
 * standalone launch, the earliest signal available there. Call once at startup.
 *
 * Caveats for reading the metric: it counts only installs the user actually
 * launched at least once (an icon added but never opened is invisible), and EU
 * iOS 17.4+ can open installed PWAs in a browser tab, where standalone
 * detection does not apply.
 */
export const trackPwaInstall = (): void => {
  if (isStandalone()) {
    reportInstallOnce();
  }
  window.addEventListener("appinstalled", reportInstallOnce);
};
