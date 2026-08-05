import { track } from "@vercel/analytics";
import { afterEach, describe, expect, it, vi } from "vitest";
import { primeScreenWakeLock, screenWakeLock } from "@/lib/wakeLock";

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

/**
 * Stub a wake lock that refuses until a gesture-backed request arrives, the
 * way WebKit answers a document that has never had one.
 */
const stubGestureOnlyWakeLock = () => {
  const sentinel: FakeSentinel = { release: vi.fn(() => Promise.resolve()) };
  let gestured = false;
  const request = vi.fn(() =>
    gestured
      ? Promise.resolve(sentinel)
      : Promise.reject(new DOMException("no", "NotAllowedError")),
  );
  vi.stubGlobal("navigator", { wakeLock: { request } });
  const allow = () => {
    gestured = true;
  };
  return { request, sentinel, allow };
};

/** Let a settled request's continuation run. */
const flush = () => Promise.resolve();

/** A tap, which is the only thing WebKit grants a first lock inside. */
const tap = () => window.dispatchEvent(new Event("click"));

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

  // WebKit refuses a lock requested outside a gesture, so a refused request is
  // not final: the next tap is the one chance left to hold the screen.
  it("asks again on the next tap after a refusal", async () => {
    const { request } = stubRefusedWakeLock("NotAllowedError");
    const subscription = screenWakeLock().subscribe();
    await flush();
    tap();
    expect(request).toHaveBeenCalledTimes(2);
    subscription.unsubscribe();
  });

  it("keeps asking on later taps while it is still refused", async () => {
    const { request } = stubRefusedWakeLock("NotAllowedError");
    const subscription = screenWakeLock().subscribe();
    await flush();
    tap();
    await flush();
    tap();
    expect(request).toHaveBeenCalledTimes(3);
    subscription.unsubscribe();
  });

  it("holds the lock a tap won", async () => {
    const { sentinel, allow } = stubGestureOnlyWakeLock();
    const subscription = screenWakeLock().subscribe();
    await flush();
    allow();
    tap();
    await flush();
    subscription.unsubscribe();
    expect(sentinel.release).toHaveBeenCalled();
  });

  // Taps land constantly on a screen the driver is using, and each one asking
  // for a lock already held would churn the lock it is holding.
  it("ignores taps while it holds a lock", async () => {
    const { request } = stubWakeLock();
    const subscription = screenWakeLock().subscribe();
    await flush();
    tap();
    expect(request).toHaveBeenCalledTimes(1);
    subscription.unsubscribe();
  });

  it("stops asking on taps after unsubscribe", async () => {
    const { request } = stubRefusedWakeLock("NotAllowedError");
    const subscription = screenWakeLock().subscribe();
    await flush();
    subscription.unsubscribe();
    tap();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not ask again on a tap without wake lock support", () => {
    vi.stubGlobal("navigator", {});
    const subscription = screenWakeLock().subscribe();
    tap();
    expect(track).toHaveBeenCalledTimes(1);
    subscription.unsubscribe();
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

describe("wake lock outcome reporting", () => {
  it("reports a platform that has no Wake Lock API", () => {
    vi.stubGlobal("navigator", {});
    screenWakeLock().subscribe().unsubscribe();
    expect(track).toHaveBeenCalledWith("wake_lock", {
      outcome: "failed",
      reason: "unsupported",
    });
  });

  it("reports a refused lock under the rejection's name", async () => {
    stubRefusedWakeLock("NotAllowedError");
    const subscription = screenWakeLock().subscribe();
    await flush();
    expect(track).toHaveBeenCalledWith("wake_lock", {
      outcome: "failed",
      reason: "NotAllowedError",
    });
    subscription.unsubscribe();
  });

  it("reports a granted lock", async () => {
    stubWakeLock();
    const subscription = screenWakeLock().subscribe();
    await flush();
    expect(track).toHaveBeenCalledWith("wake_lock", { outcome: "succeeded" });
    subscription.unsubscribe();
  });

  it("reports a lock granted after unsubscribe", async () => {
    const sentinel: FakeSentinel = { release: vi.fn(() => Promise.resolve()) };
    let grant: (granted: FakeSentinel) => void = () => {};
    const request = vi.fn(
      () =>
        new Promise<FakeSentinel>((resolve) => {
          grant = resolve;
        }),
    );
    vi.stubGlobal("navigator", { wakeLock: { request } });
    screenWakeLock().subscribe().unsubscribe();
    grant(sentinel);
    await flush();
    expect(track).toHaveBeenCalledWith("wake_lock", { outcome: "succeeded" });
  });

  // A lock is re-requested for the length of a drive, and a scanning window
  // opens and closes many times over one, so without the gate a platform emits
  // an event per app switch.
  it("reports only the first outcome of a stream's life", async () => {
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

  // The refusal is already counted by the time a tap wins the lock, so without
  // a tag on the recovery the platform reads as refusing every time it is
  // asked, which is the state this retry exists to leave.
  it("tags a lock won by a tap as a recovery", async () => {
    const { allow } = stubGestureOnlyWakeLock();
    const subscription = screenWakeLock().subscribe();
    await flush();
    allow();
    tap();
    await flush();
    expect(track).toHaveBeenCalledWith("wake_lock", {
      outcome: "succeeded",
      source: "gesture",
    });
    subscription.unsubscribe();
  });

  it("reports the refusal before a tap recovers it", async () => {
    const { allow } = stubGestureOnlyWakeLock();
    const subscription = screenWakeLock().subscribe();
    await flush();
    expect(track).toHaveBeenCalledWith("wake_lock", {
      outcome: "failed",
      reason: "NotAllowedError",
    });
    allow();
    tap();
    await flush();
    expect(track).toHaveBeenCalledTimes(2);
    subscription.unsubscribe();
  });

  it("reports a recovery once, not on every later re-request", async () => {
    const { allow } = stubGestureOnlyWakeLock();
    const subscription = screenWakeLock().subscribe();
    await flush();
    allow();
    tap();
    await flush();
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(track).toHaveBeenCalledTimes(2);
    subscription.unsubscribe();
  });

  it("reports only the first outcome when the lock is granted", async () => {
    stubWakeLock();
    const wakeLock$ = screenWakeLock();
    const subscription = wakeLock$.subscribe();
    await flush();
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    subscription.unsubscribe();
    expect(track).toHaveBeenCalledTimes(1);
  });
});

describe("primeScreenWakeLock", () => {
  it("requests a lock", () => {
    const { request } = stubWakeLock();
    primeScreenWakeLock();
    expect(request).toHaveBeenCalledWith("screen");
  });

  // Priming buys the permission, not the lock: holding this one would keep the
  // screen awake from the intro tap onward, with nothing left to release it.
  it("releases the lock it primed with", async () => {
    const { sentinel } = stubWakeLock();
    primeScreenWakeLock();
    await flush();
    expect(sentinel.release).toHaveBeenCalled();
  });

  it("reports nothing, leaving the count to the lock that matters", async () => {
    stubWakeLock();
    primeScreenWakeLock();
    await flush();
    expect(track).not.toHaveBeenCalled();
  });

  it("survives a platform that refuses inside a gesture", async () => {
    stubRefusedWakeLock("NotAllowedError");
    expect(() => {
      primeScreenWakeLock();
    }).not.toThrow();
    await flush();
    expect(track).not.toHaveBeenCalled();
  });

  it("is a no-op without wake lock support", () => {
    vi.stubGlobal("navigator", {});
    expect(() => {
      primeScreenWakeLock();
    }).not.toThrow();
  });
});
