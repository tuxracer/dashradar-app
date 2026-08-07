/**
 * Empties both web storages. localStorage holds all of the app's own state, down
 * to the install id, so a reset device reports as a new one. sessionStorage is
 * cleared too although nothing writes to it, since a reset that leaves a
 * dependency's key behind is not a reset.
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
 * Deletes every Cache Storage bucket, by key rather than by name so a cache this
 * build no longer knows about still goes.
 */
const clearCacheStorage = async (): Promise<void> => {
  if (!("caches" in window)) {
    return;
  }
  const keys = await caches.keys();
  await Promise.allSettled(keys.map((key) => caches.delete(key)));
};

/**
 * Deletes every IndexedDB database this origin owns. The app stores nothing there
 * itself, but onnxruntime-web and the browser's PWA plumbing can. A no-op on
 * older WebKit, where `databases()` does not exist to enumerate them.
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
 * Wipes every client-side store this origin owns, back to a first-run state.
 *
 * The steps are isolated on purpose: one store rejecting must not strand the rest
 * half-cleared, which is a state neither the developer nor the app has ever seen.
 * Resolving means the pass ran, not that every store was writable.
 *
 * Reloading is the caller's job and must follow this, since the unregistered
 * worker only stops serving once the page it controls goes away.
 */
export const resetAppData = async (): Promise<void> => {
  clearWebStorage();
  await Promise.allSettled([
    clearCacheStorage(),
    clearIndexedDatabases(),
    unregisterServiceWorkers(),
  ]);
};
