import { track } from "@vercel/analytics";
import { isBoolean } from "remeda";
import { PWA_INSTALL_TRACKED_KEY } from "./consts";

export * from "./consts";

/**
 * Whether the page is running as an installed PWA. `display-mode: standalone`
 * covers Chromium; `navigator.standalone` is the legacy iOS boolean Apple never
 * replaced with the standard query.
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
 * Report a one-time `pwa_installed` event. Two paths feed it, deduped by one
 * flag: Chromium's `appinstalled`, and on iOS, which has no such event, the
 * first standalone launch.
 *
 * Reading the metric: it counts only installs someone actually launched, and EU
 * iOS can open an installed PWA in a tab, where standalone detection misses.
 */
export const trackPwaInstall = (): void => {
  if (isStandalone()) {
    reportInstallOnce();
  }
  window.addEventListener("appinstalled", reportInstallOnce);
};
