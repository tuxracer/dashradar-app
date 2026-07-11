/**
 * Keeps the screen awake while detection runs. Wake locks are auto-released
 * when the tab is hidden, so an acquired manager re-requests on visibility.
 */
export const createWakeLockManager = () => {
  let sentinel: WakeLockSentinel | undefined;
  let acquired = false;

  const request = async () => {
    if (!navigator.wakeLock) {
      return;
    }
    try {
      sentinel = await navigator.wakeLock.request("screen");
    } catch {
      // Low battery or platform policy: not fatal, the app just may sleep.
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
