import { INSTALL_ID_STORAGE_KEY } from "./consts";

export * from "./consts";

/**
 * A random identifier for this install, minted on first read and kept in
 * localStorage from then on.
 *
 * It exists so a diagnostic report can tell one phone's sessions from
 * another's. Without it every crash report counts as zero users, and five
 * relaunches on one handset look exactly like five handsets failing once,
 * which are opposite conclusions about how bad a fault is.
 *
 * It is not a user identity and nothing about the device or the person goes
 * into it: it is random bytes, readable by nobody else, and clearing site data
 * or resetting the app (`resetAppData` empties localStorage) mints a new one.
 *
 * Undefined when storage is unavailable or `randomUUID` is missing, since an
 * id that cannot be stored would be new on every load and would report one
 * device as a crowd, which is worse than counting nothing at all.
 */
export const readInstallId = (): string | undefined => {
  try {
    const stored = window.localStorage.getItem(INSTALL_ID_STORAGE_KEY);
    if (stored) {
      return stored;
    }
    const minted = window.crypto.randomUUID();
    window.localStorage.setItem(INSTALL_ID_STORAGE_KEY, minted);
    return minted;
  } catch {
    return undefined;
  }
};
