import { track } from "@vercel/analytics";
import { isObjectType, isString } from "remeda";
import {
  filter,
  fromEvent,
  merge,
  Observable,
  repeat,
  startWith,
  switchMap,
} from "rxjs";
import {
  WAKE_LOCK_FAILED_OUTCOME,
  WAKE_LOCK_GESTURE_SOURCE,
  WAKE_LOCK_SUCCEEDED_OUTCOME,
  WAKE_LOCK_UNKNOWN_REASON,
  WAKE_LOCK_UNSUPPORTED_REASON,
} from "./consts";

export * from "./consts";

/**
 * A rejection's `name`, read off the value rather than through `instanceof
 * Error`: these reject with a DOMException, which does not inherit from Error
 * everywhere it is implemented.
 */
const rejectionName = (error: unknown): string => {
  const name: unknown = isObjectType(error)
    ? Reflect.get(error, "name")
    : undefined;
  return isString(name) ? name : WAKE_LOCK_UNKNOWN_REASON;
};

/**
 * Request a lock and drop it again from inside a tap handler. Nothing here holds
 * the screen open; the point is the permission it leaves behind. WebKit refuses
 * a lock without transient activation and grants a later gesture-less one only
 * because a gesture-backed request already landed on this document, which the
 * engine's own request, several awaits past any tap, never is.
 */
export const primeScreenWakeLock = () => {
  void navigator.wakeLock?.request("screen").then(
    (granted) => {
      void granted.release().catch(() => {
        // Already released by the platform.
      });
    },
    () => {
      // A platform that refuses even inside a gesture has nothing to prime.
      // Reporting is left to the engine's own request, which is the one whose
      // answer decides whether the screen stays on.
    },
  );
};

/** How far along a stream is in reporting the answer it got. */
type ReportedOutcome = "nothing" | "refused" | "settled";

/**
 * Keeps the screen awake while subscribed. It never emits and never completes, so
 * it is a resource to scope rather than a protocol a caller has to hold.
 *
 * The platform auto-releases on a hidden tab, so becoming visible requests a
 * fresh lock, and a refused one waits for the next tap. The reporting gate lives
 * in this closure, so a platform is reported once per page load.
 */
export const screenWakeLock = (): Observable<never> => {
  let reported: ReportedOutcome = "nothing";

  /**
   * Report a refusal, once. The app's worst silent failure: the screen sleeps
   * mid-drive and the detector stops seeing the road. Reported when it happens
   * rather than pending a retry, since a driver who never touches the screen has
   * no later answer.
   */
  const reportRefusal = (reason: string) => {
    if (reported !== "nothing") {
      return;
    }
    reported = "refused";
    track("wake_lock", { outcome: WAKE_LOCK_FAILED_OUTCOME, reason });
  };

  /**
   * Report a grant, once, tagging the ones after a refusal so a recovered session
   * reads as more than a contradiction of the refusal already counted. A lock is
   * re-requested all drive, so reporting every grant is one event per app switch.
   */
  const reportGrant = () => {
    if (reported === "settled") {
      return;
    }
    const recovered = reported === "refused";
    reported = "settled";
    track("wake_lock", {
      outcome: WAKE_LOCK_SUCCEEDED_OUTCOME,
      ...(recovered ? { source: WAKE_LOCK_GESTURE_SOURCE } : {}),
    });
  };

  /**
   * One held lock, released when unsubscribed. `released` covers the teardown
   * window every pending request has: unsubscribing mid-decision must let the
   * grant go, or the screen stays awake after scanning stopped. Completing on a
   * refusal is what hands the stream to the gesture retry below; a held lock
   * never completes, so a healthy session subscribes no gesture listeners.
   */
  const heldLock$ = new Observable<never>((subscriber) => {
    if (!navigator.wakeLock) {
      reportRefusal(WAKE_LOCK_UNSUPPORTED_REASON);
      return;
    }
    let sentinel: WakeLockSentinel | undefined;
    let released = false;
    void navigator.wakeLock.request("screen").then(
      (granted) => {
        // Before the teardown check: the platform granting is the answer being
        // counted whether or not this stream still wants it.
        reportGrant();
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
        reportRefusal(rejectionName(error));
        subscriber.complete();
      },
    );
    return () => {
      released = true;
      void sentinel?.release().catch(() => {
        // Already released by the platform.
      });
    };
  });

  /** The next touch or key, which is all a refused request needs to retry. */
  const userGesture$ = merge(
    fromEvent(window, "click"),
    fromEvent(window, "keydown"),
  );

  return fromEvent(document, "visibilitychange").pipe(
    filter(() => document.visibilityState === "visible"),
    startWith(undefined),
    switchMap(() => heldLock$.pipe(repeat({ delay: () => userGesture$ }))),
  );
};
