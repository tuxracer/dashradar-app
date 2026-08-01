import { track } from "@vercel/analytics";
import { isObjectType, isString } from "remeda";
import {
  WAKE_LOCK_UNKNOWN_REASON,
  WAKE_LOCK_UNSUPPORTED_REASON,
} from "./consts";

export * from "./consts";

/**
 * A rejection's `name`, or {@link WAKE_LOCK_UNKNOWN_REASON}. Read off the value
 * rather than through `instanceof Error`, because the platforms that refuse a
 * wake lock reject with a DOMException, which does not inherit from Error
 * everywhere it is implemented.
 */
const rejectionName = (error: unknown): string => {
  const name: unknown = isObjectType(error)
    ? Reflect.get(error, "name")
    : undefined;
  return isString(name) ? name : WAKE_LOCK_UNKNOWN_REASON;
};

/**
 * Keeps the screen awake while detection runs. Wake locks are auto-released
 * when the tab is hidden, so an acquired manager re-requests on visibility.
 */
export const createWakeLockManager = () => {
  let sentinel: WakeLockSentinel | undefined;
  let acquired = false;
  let failureReported = false;

  /**
   * Report the first failure of this manager's life to analytics and stay
   * quiet afterwards. A refused lock is the app's worst silent failure: the
   * screen sleeps mid-drive and the detector stops seeing the road while the
   * driver has no reason to think anything changed. Once per manager (one per
   * page load) because the visibility handler re-requests for the length of a
   * drive, and a platform that refuses once refuses every time.
   */
  const reportFailure = (reason: string) => {
    if (failureReported) {
      return;
    }
    failureReported = true;
    track("wake_lock_failed", { reason });
  };

  const request = async () => {
    if (!navigator.wakeLock) {
      reportFailure(WAKE_LOCK_UNSUPPORTED_REASON);
      return;
    }
    try {
      sentinel = await navigator.wakeLock.request("screen");
    } catch (error) {
      // Low battery or platform policy: not fatal, the app just may sleep.
      // The rejection name (NotAllowedError, AbortError) is the whole payload:
      // a handful of values, none of them describing the device or the user.
      reportFailure(rejectionName(error));
    }
  };

  const handleVisibilityChange = () => {
    if (acquired && document.visibilityState === "visible") {
      void request();
    }
  };

  const acquire = async () => {
    if (acquired) {
      return;
    }
    acquired = true;
    document.addEventListener("visibilitychange", handleVisibilityChange);
    await request();
  };

  const release = async () => {
    acquired = false;
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    try {
      await sentinel?.release();
    } catch {
      // Already released by the platform.
    }
    sentinel = undefined;
  };

  return { acquire, release };
};
