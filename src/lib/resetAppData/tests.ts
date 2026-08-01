import { afterEach, describe, expect, it, vi } from "vitest";
import { resetAppData } from "./index";

/**
 * Installs a Cache Storage stand-in (jsdom has none) whose `delete` can be made
 * to reject, so a failing bucket can be checked against the rest of the pass.
 */
const stubCaches = (keys: string[], deleteImpl?: (key: string) => unknown) => {
  const remove = vi.fn(deleteImpl ?? (() => Promise.resolve(true)));
  vi.stubGlobal("caches", {
    keys: () => Promise.resolve(keys),
    delete: remove,
  });
  return remove;
};

/** Installs a service worker registration list on the jsdom navigator. */
const stubServiceWorker = (count: number) => {
  const unregister = vi.fn(() => Promise.resolve(true));
  const registrations = Array.from({ length: count }, () => ({ unregister }));
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistrations: () => Promise.resolve(registrations) },
  });
  return unregister;
};

/** Installs an IndexedDB stand-in listing `names` and recording deletes. */
const stubIndexedDb = (names: (string | undefined)[]) => {
  const deleted: (string | undefined)[] = [];
  vi.stubGlobal("indexedDB", {
    databases: () => Promise.resolve(names.map((name) => ({ name }))),
    deleteDatabase: (name: string) => {
      deleted.push(name);
      const request: Record<string, unknown> = { error: null };
      queueMicrotask(() => (request.onsuccess as () => void)());
      return request;
    },
  });
  return deleted;
};

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("resetAppData", () => {
  it("empties both web storages", async () => {
    window.localStorage.setItem("settings", "{}");
    window.sessionStorage.setItem("timingHistory", "[]");

    await resetAppData();

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("deletes every cache bucket and unregisters every worker", async () => {
    const remove = stubCaches(["precache", "model-cache", "ort-runtime"]);
    const unregister = stubServiceWorker(2);
    const deleted = stubIndexedDb(["ort", "keyval"]);

    await resetAppData();

    expect(remove.mock.calls.flat()).toEqual([
      "precache",
      "model-cache",
      "ort-runtime",
    ]);
    expect(unregister).toHaveBeenCalledTimes(2);
    expect(deleted).toEqual(["ort", "keyval"]);
  });

  it("clears the remaining stores when one of them rejects", async () => {
    const remove = stubCaches(["precache"], () =>
      Promise.reject(new Error("quota")),
    );
    const unregister = stubServiceWorker(1);
    window.localStorage.setItem("settings", "{}");

    await expect(resetAppData()).resolves.toBeUndefined();

    expect(remove).toHaveBeenCalled();
    expect(unregister).toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
  });

  it("skips stores the browser does not implement", async () => {
    window.localStorage.setItem("settings", "{}");

    await expect(resetAppData()).resolves.toBeUndefined();

    expect(window.localStorage.length).toBe(0);
  });

  it("leaves an unnamed database alone rather than stalling on it", async () => {
    const deleted = stubIndexedDb([undefined, "keyval"]);

    await resetAppData();

    expect(deleted).toEqual(["keyval"]);
  });
});
