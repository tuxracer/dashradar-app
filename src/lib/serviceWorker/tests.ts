import { afterEach, describe, expect, it, vi } from "vitest";
import {
  waitForServiceWorkerControl,
  waitForUpdateSettled,
} from "@/lib/serviceWorker";

const makeServiceWorker = (controller: unknown) => {
  const listeners = new Set<() => void>();
  return {
    controller,
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener);
    },
    dispatch: () => {
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("waitForServiceWorkerControl", () => {
  it("resolves immediately when service workers are unsupported", async () => {
    vi.stubGlobal("navigator", {});
    await expect(waitForServiceWorkerControl(10_000)).resolves.toBeUndefined();
  });

  it("resolves immediately when a controller is already set", async () => {
    vi.stubGlobal("navigator", { serviceWorker: makeServiceWorker({}) });
    await expect(waitForServiceWorkerControl(10_000)).resolves.toBeUndefined();
  });

  it("resolves after a controllerchange when initially uncontrolled", async () => {
    const serviceWorker = makeServiceWorker(null);
    vi.stubGlobal("navigator", { serviceWorker });
    const controlled = waitForServiceWorkerControl(10_000);
    serviceWorker.dispatch();
    await expect(controlled).resolves.toBeUndefined();
  });

  it("resolves via the timeout when no controllerchange fires", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { serviceWorker: makeServiceWorker(null) });
    const controlled = waitForServiceWorkerControl(3_000);
    vi.advanceTimersByTime(3_000);
    await expect(controlled).resolves.toBeUndefined();
  });
});

/** A pending worker whose install a test can advance or kill. */
const makePendingWorker = (state = "installing") => {
  const listeners = new Set<() => void>();
  return {
    state,
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener);
    },
    setState(next: string) {
      this.state = next;
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
};

type FakeRegistration = {
  installing: ReturnType<typeof makePendingWorker> | null;
  waiting: ReturnType<typeof makePendingWorker> | null;
  update: () => Promise<void>;
};

const makeRegistration = (
  overrides: Partial<FakeRegistration> = {},
): FakeRegistration => ({
  installing: null,
  waiting: null,
  update: () => Promise.resolve(),
  ...overrides,
});

const stubControlledPage = (registration: FakeRegistration | undefined) => {
  vi.stubGlobal("navigator", {
    serviceWorker: {
      controller: {},
      getRegistration: () => Promise.resolve(registration),
    },
  });
};

const TIMEOUTS = { checkTimeoutMs: 5_000, pendingTimeoutMs: 20_000 };

describe("waitForUpdateSettled", () => {
  it("skips the check entirely when service workers are unsupported", async () => {
    vi.stubGlobal("navigator", {});
    await expect(waitForUpdateSettled(TIMEOUTS)).resolves.toBe("no-controller");
  });

  it("skips the check when no worker controls the page", async () => {
    vi.stubGlobal("navigator", { serviceWorker: { controller: null } });
    await expect(waitForUpdateSettled(TIMEOUTS)).resolves.toBe("no-controller");
  });

  it("resolves current when the check finds nothing new", async () => {
    const update = vi.fn(() => Promise.resolve());
    stubControlledPage(makeRegistration({ update }));
    await expect(waitForUpdateSettled(TIMEOUTS)).resolves.toBe("current");
    expect(update).toHaveBeenCalled();
  });

  it("proceeds when the update check itself fails", async () => {
    stubControlledPage(
      makeRegistration({ update: () => Promise.reject(new Error("offline")) }),
    );
    await expect(waitForUpdateSettled(TIMEOUTS)).resolves.toBe("check-failed");
  });

  it("proceeds when a controlled page somehow has no registration", async () => {
    stubControlledPage(undefined);
    await expect(waitForUpdateSettled(TIMEOUTS)).resolves.toBe("check-failed");
  });

  it("gives up on a check that hangs past its bound", async () => {
    vi.useFakeTimers();
    stubControlledPage(
      makeRegistration({ update: () => new Promise(() => {}) }),
    );
    const settled = waitForUpdateSettled(TIMEOUTS);
    await vi.advanceTimersByTimeAsync(TIMEOUTS.checkTimeoutMs);
    await expect(settled).resolves.toBe("check-timeout");
  });

  it("skips the network ask when an update is already installing", async () => {
    const update = vi.fn(() => Promise.resolve());
    const worker = makePendingWorker();
    stubControlledPage(makeRegistration({ installing: worker, update }));
    const settled = waitForUpdateSettled(TIMEOUTS);
    await Promise.resolve();
    worker.setState("redundant");
    await expect(settled).resolves.toBe("install-failed");
    expect(update).not.toHaveBeenCalled();
  });

  it("stops holding when a pending install dies, since no reload is coming", async () => {
    const worker = makePendingWorker();
    const registration = makeRegistration({
      update: () => {
        registration.installing = worker;
        return Promise.resolve();
      },
    });
    stubControlledPage(registration);
    const settled = waitForUpdateSettled(TIMEOUTS);
    // A macrotask so the hold is reached and its statechange listener is on.
    await new Promise((resolve) => setTimeout(resolve));
    worker.setState("redundant");
    await expect(settled).resolves.toBe("install-failed");
  });

  it("gives up holding for an install that outlives its bound", async () => {
    vi.useFakeTimers();
    stubControlledPage(makeRegistration({ installing: makePendingWorker() }));
    const settled = waitForUpdateSettled(TIMEOUTS);
    await vi.advanceTimersByTimeAsync(TIMEOUTS.pendingTimeoutMs);
    await expect(settled).resolves.toBe("pending-timeout");
  });
});
