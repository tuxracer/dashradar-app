import { track } from "@vercel/analytics";
import { LAST_RUN_COMMIT_KEY, UNKNOWN_COMMIT_SHA } from "./consts";

export * from "./consts";

/**
 * Report an `app_updated` event with the commit SHA this device came from and
 * the one it is now running, then remember the running build either way. Call
 * once at startup.
 *
 * The update is counted where it lands rather than where the service worker
 * finds it: an installing worker knows a new build exists but not which commit
 * it carries, while the build that boots afterwards knows its own SHA exactly.
 * That also makes the number "sessions that actually ran the new build", which
 * is what a rollout question is really asking, instead of "updates downloaded".
 * The cost is one launch of lag, and an update that installs but is never
 * launched again never counts.
 *
 * A first run, or the launch after a data reset, records the build silently:
 * there is no previous build to have come from.
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
