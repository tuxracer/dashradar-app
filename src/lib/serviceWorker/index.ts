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

/**
 * Fire-and-forget request for persistent storage so the browser is less likely
 * to evict the runtime caches between visits, especially the large model
 * weights. Guarded for browsers without the Storage API; rejection is swallowed
 * because the request is best-effort and its result is not awaited.
 */
export const requestPersistentStorage = (): void => {
  void navigator.storage?.persist?.()?.catch?.(() => {});
};
