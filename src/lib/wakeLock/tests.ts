import { track } from "@vercel/analytics";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWakeLockManager } from "@/lib/wakeLock";

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

type FakeSentinel = { release: ReturnType<typeof vi.fn> };

const stubWakeLock = () => {
  const sentinel: FakeSentinel = { release: vi.fn(() => Promise.resolve()) };
  const request = vi.fn(() => Promise.resolve(sentinel));
  vi.stubGlobal("navigator", { wakeLock: { request } });
  return { request, sentinel };
};

/** Stub a wake lock that refuses every request with `name`. */
const stubRefusedWakeLock = (name: string) => {
  const request = vi.fn(() => Promise.reject(new DOMException("no", name)));
  vi.stubGlobal("navigator", { wakeLock: { request } });
  return { request };
};

const listeners: Array<[string, EventListener]> = [];
const originalAddEventListener = document.addEventListener;
const originalRemoveEventListener = document.removeEventListener;

beforeEach(() => {
  listeners.length = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (document.addEventListener as any) = ((
    event: string,
    listener: EventListener,
  ) => {
    listeners.push([event, listener]);
    return originalAddEventListener.call(document, event, listener);
  }) as unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (document.removeEventListener as any) = ((
    event: string,
    listener: EventListener,
  ) => {
    const index = listeners.findIndex(
      ([e, l]) => e === event && l === listener,
    );
    if (index >= 0) {
      listeners.splice(index, 1);
    }
    return originalRemoveEventListener.call(document, event, listener);
  }) as unknown;
});

afterEach(() => {
  // Clean up all tracked listeners
  for (const [event, listener] of listeners) {
    originalRemoveEventListener.call(document, event, listener);
  }
  listeners.length = 0;
  document.addEventListener = originalAddEventListener;
  document.removeEventListener = originalRemoveEventListener;
  vi.unstubAllGlobals();
  vi.mocked(track).mockClear();
});

describe("createWakeLockManager", () => {
  it("requests a screen wake lock on acquire", async () => {
    const { request } = stubWakeLock();
    await createWakeLockManager().acquire();
    expect(request).toHaveBeenCalledWith("screen");
  });

  it("releases the sentinel on release", async () => {
    const { sentinel } = stubWakeLock();
    const manager = createWakeLockManager();
    await manager.acquire();
    await manager.release();
    expect(sentinel.release).toHaveBeenCalled();
  });

  it("re-requests the lock when the page becomes visible again", async () => {
    const { request } = stubWakeLock();
    const manager = createWakeLockManager();
    await manager.acquire();
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("stops re-requesting after release", async () => {
    const { request } = stubWakeLock();
    const manager = createWakeLockManager();
    await manager.acquire();
    await manager.release();
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("releases a lock granted after release was already called", async () => {
    const sentinel: FakeSentinel = { release: vi.fn(() => Promise.resolve()) };
    let grant: (granted: FakeSentinel) => void = () => {};
    const request = vi.fn(
      () =>
        new Promise<FakeSentinel>((resolve) => {
          grant = resolve;
        }),
    );
    vi.stubGlobal("navigator", { wakeLock: { request } });
    const manager = createWakeLockManager();
    const acquiring = manager.acquire();
    await manager.release();
    grant(sentinel);
    await acquiring;
    expect(sentinel.release).toHaveBeenCalled();
  });

  it("is a no-op without wake lock support", async () => {
    vi.stubGlobal("navigator", {});
    const manager = createWakeLockManager();
    await expect(manager.acquire()).resolves.toBeUndefined();
    await expect(manager.release()).resolves.toBeUndefined();
  });
});

describe("wake lock failure reporting", () => {
  it("reports a platform that has no Wake Lock API", async () => {
    vi.stubGlobal("navigator", {});
    await createWakeLockManager().acquire();
    expect(track).toHaveBeenCalledWith("wake_lock_failed", {
      reason: "unsupported",
    });
  });

  it("reports a refused lock under the rejection's name", async () => {
    stubRefusedWakeLock("NotAllowedError");
    await createWakeLockManager().acquire();
    expect(track).toHaveBeenCalledWith("wake_lock_failed", {
      reason: "NotAllowedError",
    });
  });

  it("stays quiet when the lock is granted", async () => {
    stubWakeLock();
    await createWakeLockManager().acquire();
    expect(track).not.toHaveBeenCalled();
  });

  // The visibility handler re-requests for the length of a drive, so without
  // the guard a platform that refuses emits an event per app switch.
  it("reports only the first failure of a manager's life", async () => {
    stubRefusedWakeLock("NotAllowedError");
    const manager = createWakeLockManager();
    await manager.acquire();
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    await manager.release();
    await manager.acquire();
    expect(track).toHaveBeenCalledTimes(1);
  });
});
