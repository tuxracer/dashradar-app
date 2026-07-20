import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForServiceWorkerControl } from "@/lib/serviceWorker";

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
