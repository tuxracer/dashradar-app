import { track } from "@vercel/analytics";
import { isObjectType, isString } from "remeda";
import { filter, fromEvent, Observable, startWith, switchMap } from "rxjs";
import {
  WAKE_LOCK_FAILED_OUTCOME,
  WAKE_LOCK_SUCCEEDED_OUTCOME,
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
 * Keeps the screen awake for exactly as long as the returned stream is
 * subscribed: subscribing requests a lock, unsubscribing releases it. It never
 * emits and never completes, so it is a resource to scope under whatever
 * should hold the screen open rather than an acquire/release protocol a caller
 * has to hold correctly.
 *
 * Wake locks are auto-released when the tab is hidden, so becoming visible
 * again requests a fresh one and drops the previous holder.
 *
 * The once-per-instance reporting gate lives in this closure rather than in a
 * subscription, so one stream subscribed and unsubscribed once per scanning
 * window reports a platform once for the page load, not once per window.
 */
export const screenWakeLock = (): Observable<never> => {
  let outcomeReported = false;

  /**
   * Report how this stream's first lock request was answered and stay quiet
   * afterwards. A refused lock is the app's worst silent failure: the screen
   * sleeps mid-drive and the detector stops seeing the road while the driver
   * has no reason to think anything changed, and the grants are the
   * denominator that makes the refusal count mean something. A platform
   * answers the same way every time, and a lock is re-requested for the length
   * of a drive, so reporting every answer would be one event per app switch.
   */
  const reportOutcome = (properties: Record<string, string>) => {
    if (outcomeReported) {
      return;
    }
    outcomeReported = true;
    track("wake_lock", properties);
  };

  /**
   * One held lock, released when unsubscribed. The `released` flag covers the
   * teardown window every pending request has: unsubscribing while the
   * platform is still deciding has to let the grant go rather than store it,
   * or the screen stays awake after scanning stopped.
   */
  const heldLock$ = new Observable<never>(() => {
    if (!navigator.wakeLock) {
      reportOutcome({
        outcome: WAKE_LOCK_FAILED_OUTCOME,
        reason: WAKE_LOCK_UNSUPPORTED_REASON,
      });
      return;
    }
    let sentinel: WakeLockSentinel | undefined;
    let released = false;
    void navigator.wakeLock.request("screen").then(
      (granted) => {
        // Reported before the teardown check, because the platform granting is
        // the answer being counted whether or not this stream still wants it.
        reportOutcome({ outcome: WAKE_LOCK_SUCCEEDED_OUTCOME });
        if (released) {
          void granted.release().catch(() => {
            // Already released by the platform.
          });
          return;
        }
        sentinel = granted;
      },
      (error: unknown) => {
        // Low battery or platform policy: not fatal, the app just may sleep.
        // The rejection name (NotAllowedError, AbortError) is the whole
        // payload: a handful of values, none of them describing the device or
        // the user.
        reportOutcome({
          outcome: WAKE_LOCK_FAILED_OUTCOME,
          reason: rejectionName(error),
        });
      },
    );
    return () => {
      released = true;
      void sentinel?.release().catch(() => {
        // Already released by the platform.
      });
    };
  });

  return fromEvent(document, "visibilitychange").pipe(
    filter(() => document.visibilityState === "visible"),
    startWith(undefined),
    switchMap(() => heldLock$),
  );
};
