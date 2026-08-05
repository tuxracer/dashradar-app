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
 * Request a lock and drop it again, from inside the handler of a tap the user
 * just made. Nothing here holds the screen open; the point is the permission it
 * leaves behind.
 *
 * WebKit refuses a wake lock requested without transient activation, and grants
 * a later gesture-less one only because a gesture-backed request already landed
 * on this document (`m_wasPreviouslyAuthorizedDueToTransientActivation` in
 * WebKit's `WakeLock.cpp`). The engine asks for its lock once scanning starts,
 * several awaits past the tap that set the app going, so on iOS it is refused
 * and stays refused for the life of the page. Spending one throwaway request
 * inside a tap is what lets the real one succeed. The flag is per document, so
 * this belongs on the gestures a session passes through on its way to scanning,
 * and it has to happen again on every page load.
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
 * Keeps the screen awake for exactly as long as the returned stream is
 * subscribed: subscribing requests a lock, unsubscribing releases it. It never
 * emits and never completes, so it is a resource to scope under whatever
 * should hold the screen open rather than an acquire/release protocol a caller
 * has to hold correctly.
 *
 * Wake locks are auto-released when the tab is hidden, so becoming visible
 * again requests a fresh one and drops the previous holder.
 *
 * A refused lock waits for the next tap and asks again, because on WebKit a
 * request made from inside a gesture is the one that can still succeed (see
 * {@link primeScreenWakeLock}). Priming covers the session that reaches
 * scanning through the intro; this covers the returning one that reaches it
 * through no taps at all, taking the driver's first touch of the screen,
 * whenever it comes, as the chance to try again.
 *
 * The reporting gate lives in this closure rather than in a subscription, so
 * one stream subscribed and unsubscribed once per scanning window reports a
 * platform once for the page load, not once per window.
 */
export const screenWakeLock = (): Observable<never> => {
  let reported: ReportedOutcome = "nothing";

  /**
   * Report a refusal, once. A refused lock is the app's worst silent failure:
   * the screen sleeps mid-drive and the detector stops seeing the road while
   * the driver has no reason to think anything changed. It is reported when it
   * happens rather than held open pending a retry, because a session whose
   * driver never touches the screen has no later answer to report and must not
   * go missing from the count.
   *
   * The rejection name (NotAllowedError, AbortError) is the whole payload: a
   * handful of values, none of them describing the device or the user.
   */
  const reportRefusal = (reason: string) => {
    if (reported !== "nothing") {
      return;
    }
    reported = "refused";
    track("wake_lock", { outcome: WAKE_LOCK_FAILED_OUTCOME, reason });
  };

  /**
   * Report a grant, once, tagging the ones that arrive after a refusal so a
   * recovered session reads as more than a contradiction of the refusal already
   * counted. A platform answers the same way every time, and a lock is
   * re-requested for the length of a drive, so reporting every grant would be
   * one event per app switch.
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
   * One held lock, released when unsubscribed. The `released` flag covers the
   * teardown window every pending request has: unsubscribing while the
   * platform is still deciding has to let the grant go rather than store it,
   * or the screen stays awake after scanning stopped.
   *
   * Completing on a refusal is what hands the stream to the gesture retry
   * below. A held lock deliberately never completes, so a healthy session
   * subscribes no gesture listeners at all, and neither does a platform with no
   * API, where there is nothing a tap could change.
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
        // Reported before the teardown check, because the platform granting is
        // the answer being counted whether or not this stream still wants it.
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
