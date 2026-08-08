import { INSTALL_ID_STORAGE_KEY } from "./consts";

export * from "./consts";

/**
 * A random identifier for this install, so a report can tell one phone's sessions
 * from another's: five relaunches on one handset otherwise look exactly like five
 * handsets failing once. Not a user identity, and a data reset mints a new one.
 * Undefined where it cannot be stored, since an id that is new every load reports
 * one device as a crowd.
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
