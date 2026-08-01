import type { UpdateSettledResult } from "./types";

export * from "./consts";
export * from "./types";

/**
 * Resolves when the page is controlled by a service worker, or after
 * `timeoutMs`, whichever comes first. On a genuine first visit the app's
 * dedicated worker can start fetching the model before Workbox's service
 * worker takes control (the clientsClaim race), which bypasses the runtime
 * caches. Awaiting control first lets those fetches be cached on the first
 * visit. The timeout keeps startup from stalling if control never arrives.
 */
export const waitForServiceWorkerControl = (
  timeoutMs: number,
): Promise<void> => {
  if (!("serviceWorker" in navigator)) {
    return Promise.resolve();
  }
  if (navigator.serviceWorker.controller) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const cleanup = () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onChange);
      window.clearTimeout(timer);
    };
    const onChange = () => {
      cleanup();
      resolve();
    };
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);
    navigator.serviceWorker.addEventListener("controllerchange", onChange);
  });
};

const TIMED_OUT = Symbol("timed-out");

/** Resolves to `TIMED_OUT` if `promise` has not settled within `timeoutMs`. */
const raceTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | typeof TIMED_OUT> =>
  new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => resolve(TIMED_OUT), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (reason: unknown) => {
        window.clearTimeout(timer);
        reject(reason instanceof Error ? reason : new Error(String(reason)));
      },
    );
  });

/**
 * Resolves once this launch's app-update question is settled, so acquiring
 * the camera cannot collide with an update reload. iOS forgets camera
 * permission between launches of an installed web app, and the silent
 * auto-update reload lands seconds after the driver answers the permission
 * prompt, which prompts them a second time. Awaiting this before the first
 * `getUserMedia` reorders an update launch to reload first, one prompt total.
 *
 * Every resolved value means "go ahead". The one path that keeps holding, an
 * update installing normally, exits via the page reload instead of resolving.
 * Every failure path resolves, so the worst outcome is the old double prompt,
 * never a stalled startup.
 */
export const waitForUpdateSettled = async ({
  checkTimeoutMs,
  pendingTimeoutMs,
}: {
  checkTimeoutMs: number;
  pendingTimeoutMs: number;
}): Promise<UpdateSettledResult> => {
  // No controlling worker means no previous build an update could replace: a
  // first visit, a dev server (which registers no worker), or a browser
  // without service workers at all.
  const container =
    "serviceWorker" in navigator ? navigator.serviceWorker : undefined;
  if (!container?.controller) {
    return "no-controller";
  }

  let registration: ServiceWorkerRegistration | undefined;
  try {
    const found = await raceTimeout(
      container.getRegistration(),
      checkTimeoutMs,
    );
    if (found === TIMED_OUT) {
      return "check-timeout";
    }
    registration = found;
  } catch {
    return "check-failed";
  }
  if (!registration) {
    return "check-failed";
  }

  // registerSW's own registration pass may already have found the update; only
  // ask the network when nothing is pending yet. The explicit update() is what
  // gives a definite "nothing new" verdict, which no event announces.
  if (!registration.installing && !registration.waiting) {
    try {
      const checked = await raceTimeout(registration.update(), checkTimeoutMs);
      if (checked === TIMED_OUT) {
        return "check-timeout";
      }
    } catch {
      return "check-failed";
    }
  }
  const worker = registration.installing ?? registration.waiting;
  if (!worker) {
    return "current";
  }

  // An update is installing. The auto-update reload arrives when it
  // activates; hold for it, resolving only if the install dies (redundant
  // worker, no reload coming) or drags past the promised bound.
  return new Promise<UpdateSettledResult>((resolve) => {
    const settle = (result: UpdateSettledResult) => {
      window.clearTimeout(timer);
      worker.removeEventListener("statechange", onStateChange);
      resolve(result);
    };
    const onStateChange = () => {
      if (worker.state === "redundant") {
        settle("install-failed");
      }
    };
    const timer = window.setTimeout(
      () => settle("pending-timeout"),
      pendingTimeoutMs,
    );
    worker.addEventListener("statechange", onStateChange);
    // The install may already have died before the listener attached.
    onStateChange();
  });
};

/**
 * Fire-and-forget request for persistent storage so the browser is less likely
 * to evict the runtime caches between visits, especially the large model
 * weights. Guarded for browsers without the Storage API; rejection is swallowed
 * because the request is best-effort and its result is not awaited.
 */
export const requestPersistentStorage = (): void => {
  void navigator.storage?.persist?.()?.catch?.(() => {});
};
