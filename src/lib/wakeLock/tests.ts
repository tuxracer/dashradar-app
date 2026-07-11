import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWakeLockManager } from "@/lib/wakeLock";

type FakeSentinel = { release: ReturnType<typeof vi.fn> };

const stubWakeLock = () => {
  const sentinel: FakeSentinel = { release: vi.fn(() => Promise.resolve()) };
  const request = vi.fn(() => Promise.resolve(sentinel));
  vi.stubGlobal("navigator", { wakeLock: { request } });
  return { request, sentinel };
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

  it("is a no-op without wake lock support", async () => {
    vi.stubGlobal("navigator", {});
    const manager = createWakeLockManager();
    await expect(manager.acquire()).resolves.toBeUndefined();
    await expect(manager.release()).resolves.toBeUndefined();
  });
});
