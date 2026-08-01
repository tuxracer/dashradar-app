/**
 * Empties localStorage and sessionStorage: the settings blob, the intro and
 * camera-prompt flags, the PWA-install analytics guard, the crash-sentinel
 * record, and the session's timing history. Each store is cleared on its own
 * so an unavailable one (private mode / quota) still lets the other go.
 */
const clearWebStorage = (): void => {
  try {
    window.localStorage.clear();
  } catch {
    // Storage unavailable (private mode / quota); nothing to clear.
  }
  try {
    window.sessionStorage.clear();
  } catch {
    // Storage unavailable (private mode / quota); nothing to clear.
  }
};

/**
 * Deletes every Cache Storage bucket: the Workbox precache, the `ort-runtime`
 * and `model-cache` runtime caches (the ~57 MB weights live here), and the dev
 * model cache. Deleting by key rather than by name so a cache this build no
 * longer knows about still goes.
 */
const clearCacheStorage = async (): Promise<void> => {
  if (!("caches" in window)) {
    return;
  }
  const keys = await caches.keys();
  await Promise.allSettled(keys.map((key) => caches.delete(key)));
};

/**
 * Deletes every IndexedDB database this origin owns. The app stores nothing
 * there itself, but onnxruntime-web and the browser's own PWA plumbing can, and
 * a reset that leaves a store behind is not a reset. `databases()` is missing
 * on older WebKit, where there is no way to enumerate them and the step is a
 * no-op.
 */
const clearIndexedDatabases = async (): Promise<void> => {
  if (!window.indexedDB?.databases) {
    return;
  }
  const databases = await window.indexedDB.databases();
  await Promise.allSettled(
    databases.map(
      ({ name }) =>
        new Promise<void>((resolve, reject) => {
          if (!name) {
            resolve();
            return;
          }
          const request = window.indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onblocked = () => resolve();
          request.onerror = () => reject(request.error);
        }),
    ),
  );
};

/**
 * Unregisters every service worker registration for this scope, so the reload
 * that follows fetches the app fresh from the network instead of being served
 * the precache the previous worker still controls.
 */
const unregisterServiceWorkers = async (): Promise<void> => {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.allSettled(
    registrations.map((registration) => registration.unregister()),
  );
};

/**
 * Wipes every client-side store this origin owns, returning the app to a
 * first-run state: web storage, Cache Storage, IndexedDB, and the service
 * worker registrations.
 *
 * The steps are isolated from each other on purpose. One store rejecting
 * (private mode, quota, a blocked IndexedDB delete) must not strand the rest
 * half-cleared, which would leave a state neither the developer nor the app
 * has ever seen, so every step settles on its own and its failure is dropped.
 * Resolving means the clearing pass ran, not that every store was writable.
 *
 * Reloading is the caller's job and must happen after this resolves: the
 * unregistered worker only stops serving once the page it controls goes away.
 */
export const resetAppData = async (): Promise<void> => {
  clearWebStorage();
  await Promise.allSettled([
    clearCacheStorage(),
    clearIndexedDatabases(),
    unregisterServiceWorkers(),
  ]);
};
