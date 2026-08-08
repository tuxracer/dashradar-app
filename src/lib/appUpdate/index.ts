import { track } from "@vercel/analytics";
import { LAST_RUN_COMMIT_KEY, UNKNOWN_COMMIT_SHA } from "./consts";

export * from "./consts";

/**
 * Report an `app_updated` event with the SHA this device came from and the one it
 * now runs, then remember the running build either way. Counted where it lands
 * rather than where the service worker finds it, since an installing worker does
 * not know which commit it carries, which also makes the number "sessions that
 * ran the new build". A first run records the build silently.
 */
export const trackAppUpdate = (): void => {
  const to = __COMMIT_SHA__;
  if (to === UNKNOWN_COMMIT_SHA) {
    return;
  }

  let from: string | null = null;
  try {
    from = window.localStorage.getItem(LAST_RUN_COMMIT_KEY);
    window.localStorage.setItem(LAST_RUN_COMMIT_KEY, to);
  } catch {
    // Storage unavailable (private mode / quota). A failed read leaves `from`
    // null and reports nothing; a failed write after a good read still reports
    // the update, and may report it again next launch, which beats losing it.
  }

  if (from !== null && from !== to) {
    track("app_updated", { from, to });
  }
};
