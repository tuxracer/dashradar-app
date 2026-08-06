import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOrientationAccess } from "./index";

/**
 * Stands in for the constructor WebKit exposes. Passing no ask models every
 * other engine, where the sensors are open and there is nothing to request.
 */
const stubOrientationEvent = (ask?: () => Promise<"granted" | "denied">) => {
  class StubDeviceOrientationEvent {}
  if (ask) {
    Reflect.set(StubDeviceOrientationEvent, "requestPermission", ask);
  }
  vi.stubGlobal("DeviceOrientationEvent", StubDeviceOrientationEvent);
};

/** One sensor reading reaching the page, however empty. */
const reading = () => {
  act(() => {
    window.dispatchEvent(new Event("deviceorientation"));
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useOrientationAccess", () => {
  it("asks the driver for a gesture where the sensors are gated", () => {
    stubOrientationEvent(vi.fn().mockResolvedValue("granted" as const));

    const { result } = renderHook(() => useOrientationAccess(true));

    expect(result.current.needsGesture).toBe(true);
  });

  it("asks for nothing where the sensors are open", () => {
    stubOrientationEvent();

    const { result } = renderHook(() => useOrientationAccess(true));

    expect(result.current.needsGesture).toBe(false);
  });

  it("asks for nothing while inactive", () => {
    stubOrientationEvent(vi.fn().mockResolvedValue("granted" as const));

    const { result } = renderHook(() => useOrientationAccess(false));

    expect(result.current.needsGesture).toBe(false);
  });

  it("settles on the first reading, whatever it holds", () => {
    stubOrientationEvent(vi.fn().mockResolvedValue("granted" as const));

    const { result } = renderHook(() => useOrientationAccess(true));
    reading();

    expect(result.current.needsGesture).toBe(false);
  });

  it("settles when the driver answers, granted or not", async () => {
    const ask = vi.fn().mockResolvedValue("denied" as const);
    stubOrientationEvent(ask);

    const { result } = renderHook(() => useOrientationAccess(true));
    act(() => {
      result.current.request();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(ask).toHaveBeenCalledTimes(1);
    expect(result.current.needsGesture).toBe(false);
  });

  it("stays settled once a reading has arrived", () => {
    stubOrientationEvent(vi.fn().mockResolvedValue("granted" as const));

    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useOrientationAccess(active),
      { initialProps: { active: true } },
    );
    reading();
    rerender({ active: true });

    expect(result.current.needsGesture).toBe(false);
  });

  it("stops asking once unmounted", async () => {
    const ask = vi.fn().mockResolvedValue("granted" as const);
    stubOrientationEvent(ask);

    const { unmount } = renderHook(() => useOrientationAccess(true));
    unmount();
    window.dispatchEvent(new Event("click"));

    expect(ask).not.toHaveBeenCalled();
  });
});
