import { afterEach, describe, expect, it, vi } from "vitest";
import { askForOrientationAccess } from "./index";

/**
 * Stands in for the constructor WebKit exposes, with the ask under test's
 * control. Passing no ask models every other engine, where the sensors are
 * open and the constructor carries no requestPermission at all.
 */
const stubOrientationEvent = (ask?: () => Promise<"granted" | "denied">) => {
  class StubDeviceOrientationEvent {}
  if (ask) {
    Reflect.set(StubDeviceOrientationEvent, "requestPermission", ask);
  }
  vi.stubGlobal("DeviceOrientationEvent", StubDeviceOrientationEvent);
};

/** A tap, as the window sees it. */
const tap = () => {
  window.dispatchEvent(new Event("click"));
};

/**
 * Starts asking, keeping hold of the signal the gesture listeners were
 * registered with so a test can see whether they are still attached. Asked
 * directly, because "does not ask a second time" is also true of a version
 * that listens to every click for the rest of the drive, which is the cost
 * that dropping the listeners exists to avoid.
 */
const startAsking = () => {
  const listen = vi.spyOn(window, "addEventListener");
  const stop = askForOrientationAccess();
  const signals = listen.mock.calls.flatMap(([, , options]) =>
    typeof options === "object" && options.signal ? [options.signal] : [],
  );
  listen.mockRestore();
  return {
    stop,
    listening: () =>
      signals.length > 0 && signals.every((signal) => !signal.aborted),
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("askForOrientationAccess", () => {
  it("asks on the first gesture, not before one", async () => {
    const ask = vi.fn().mockResolvedValue("granted" as const);
    stubOrientationEvent(ask);

    askForOrientationAccess();
    expect(ask).not.toHaveBeenCalled();

    tap();
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("stops listening once the driver has answered", async () => {
    const ask = vi.fn().mockResolvedValue("granted" as const);
    stubOrientationEvent(ask);

    const asking = startAsking();
    tap();
    await vi.waitFor(() => {
      expect(asking.listening()).toBe(false);
    });

    tap();
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("stops listening on a refusal too, since it will not be reconsidered", async () => {
    const ask = vi.fn().mockResolvedValue("denied" as const);
    stubOrientationEvent(ask);

    const asking = startAsking();
    tap();
    await vi.waitFor(() => {
      expect(asking.listening()).toBe(false);
    });

    tap();
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("tries the next gesture when the ask itself was rejected", async () => {
    // What a call outside a gesture gets, which is an ask the driver never
    // saw rather than an answer from them.
    const ask = vi
      .fn()
      .mockRejectedValueOnce(new Error("no transient activation"))
      .mockResolvedValue("granted" as const);
    stubOrientationEvent(ask);

    const asking = startAsking();
    tap();
    await vi.waitFor(() => {
      expect(ask).toHaveBeenCalledTimes(1);
    });
    expect(asking.listening()).toBe(true);

    tap();
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("stops asking when torn down", () => {
    const ask = vi.fn().mockResolvedValue("granted" as const);
    stubOrientationEvent(ask);

    askForOrientationAccess()();
    tap();

    expect(ask).not.toHaveBeenCalled();
  });

  it("wires up nothing where the sensors are not gated", () => {
    stubOrientationEvent();
    const listen = vi.spyOn(window, "addEventListener");

    const stop = askForOrientationAccess();
    tap();
    stop();

    expect(listen).not.toHaveBeenCalled();
    listen.mockRestore();
  });

  it("wires up nothing where there is no orientation event at all", () => {
    vi.stubGlobal("DeviceOrientationEvent", undefined);
    const listen = vi.spyOn(window, "addEventListener");

    askForOrientationAccess()();

    expect(listen).not.toHaveBeenCalled();
    listen.mockRestore();
  });
});
