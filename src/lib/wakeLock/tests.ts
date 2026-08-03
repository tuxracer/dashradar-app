import { track } from "@vercel/analytics";
import { afterEach, describe, expect, it, vi } from "vitest";
import { screenWakeLock } from "@/lib/wakeLock";

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

/** Let a settled request's continuation run. */
const flush = () => Promise.resolve();

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(track).mockClear();
});

describe("screenWakeLock", () => {
  it("requests a screen wake lock on subscribe", () => {
    const { request } = stubWakeLock();
    const subscription = screenWakeLock().subscribe();
    expect(request).toHaveBeenCalledWith("screen");
    subscription.unsubscribe();
  });

  it("requests nothing until subscribed", () => {
    const { request } = stubWakeLock();
    screenWakeLock();
    expect(request).not.toHaveBeenCalled();
  });

  it("releases the sentinel on unsubscribe", async () => {
    const { sentinel } = stubWakeLock();
    const subscription = screenWakeLock().subscribe();
    await flush();
    subscription.unsubscribe();
    expect(sentinel.release).toHaveBeenCalled();
  });

  it("re-requests the lock when the page becomes visible again", async () => {
    const { request } = stubWakeLock();
    const subscription = screenWakeLock().subscribe();
    await flush();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(request).toHaveBeenCalledTimes(2);
    subscription.unsubscribe();
  });

  it("stops re-requesting after unsubscribe", async () => {
    const { request } = stubWakeLock();
    const subscription = screenWakeLock().subscribe();
    await flush();
    subscription.unsubscribe();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("releases a lock granted after unsubscribe", async () => {
    const sentinel: FakeSentinel = { release: vi.fn(() => Promise.resolve()) };
    let grant: (granted: FakeSentinel) => void = () => {};
    const request = vi.fn(
      () =>
        new Promise<FakeSentinel>((resolve) => {
          grant = resolve;
        }),
    );
    vi.stubGlobal("navigator", { wakeLock: { request } });
    const subscription = screenWakeLock().subscribe();
    subscription.unsubscribe();
    grant(sentinel);
    await flush();
    expect(sentinel.release).toHaveBeenCalled();
  });

  it("is a no-op without wake lock support", () => {
    vi.stubGlobal("navigator", {});
    const subscription = screenWakeLock().subscribe();
    expect(() => {
      subscription.unsubscribe();
    }).not.toThrow();
  });

  it("holds one lock at a time across a re-request", async () => {
    const { sentinel } = stubWakeLock();
    const subscription = screenWakeLock().subscribe();
    await flush();
    document.dispatchEvent(new Event("visibilitychange"));
    // The lock the platform auto-released when the page went hidden is
    // dropped as the fresh request goes out, so nothing outlives the window.
    expect(sentinel.release).toHaveBeenCalledTimes(1);
    subscription.unsubscribe();
  });
});

describe("wake lock failure reporting", () => {
  it("reports a platform that has no Wake Lock API", () => {
    vi.stubGlobal("navigator", {});
    screenWakeLock().subscribe().unsubscribe();
    expect(track).toHaveBeenCalledWith("wake_lock_failed", {
      reason: "unsupported",
    });
  });

  it("reports a refused lock under the rejection's name", async () => {
    stubRefusedWakeLock("NotAllowedError");
    const subscription = screenWakeLock().subscribe();
    await flush();
    expect(track).toHaveBeenCalledWith("wake_lock_failed", {
      reason: "NotAllowedError",
    });
    subscription.unsubscribe();
  });

  it("stays quiet when the lock is granted", async () => {
    stubWakeLock();
    const subscription = screenWakeLock().subscribe();
    await flush();
    expect(track).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });

  // A lock is re-requested for the length of a drive, and a scanning window
  // opens and closes many times over one, so without the gate a platform that
  // refuses emits an event per app switch.
  it("reports only the first failure of a stream's life", async () => {
    stubRefusedWakeLock("NotAllowedError");
    const wakeLock$ = screenWakeLock();
    const first = wakeLock$.subscribe();
    await flush();
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    first.unsubscribe();
    const second = wakeLock$.subscribe();
    await flush();
    second.unsubscribe();
    expect(track).toHaveBeenCalledTimes(1);
  });
});
