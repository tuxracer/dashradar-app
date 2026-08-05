import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useRadarBeeper } from "./index";

const beeperUpdate = vi.fn<(level: number, nowMs: number) => void>();
const beeperDispose = vi.fn();

vi.mock("@/lib/radarAudio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/radarAudio")>()),
  createRadarBeeper: () => ({
    update: beeperUpdate,
    dispose: beeperDispose,
  }),
}));

type Inputs = { confidence: number; audioEnabled: boolean };

const beeping = (initialProps: Inputs) =>
  renderHook(
    ({ confidence, audioEnabled }: Inputs) =>
      useRadarBeeper(confidence, audioEnabled),
    { initialProps },
  );

/** Let a few animation frames pass, so an unparked loop would tick again. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

describe("useRadarBeeper", () => {
  it("feeds the beeper the level it was given", async () => {
    beeperUpdate.mockClear();
    beeping({ confidence: 0.8, audioEnabled: true });
    await waitFor(() =>
      expect(beeperUpdate).toHaveBeenCalledWith(0.8, expect.any(Number)),
    );
  });

  it("feeds silence rather than stopping when the audio setting is off", async () => {
    // Stopping would leave a beeper mid-alert holding its last state instead
    // of falling quiet.
    beeperUpdate.mockClear();
    beeping({ confidence: 0.8, audioEnabled: false });
    await waitFor(() => expect(beeperUpdate).toHaveBeenCalled());
    expect(beeperUpdate).toHaveBeenLastCalledWith(0, expect.any(Number));
  });

  // The thermal invariant: quiet scanning is the dominant state of a drive,
  // and it must schedule no animation frames at all.
  it("parks on silence after a single tick", async () => {
    beeperUpdate.mockClear();
    beeping({ confidence: 0, audioEnabled: true });
    await waitFor(() => expect(beeperUpdate).toHaveBeenCalledTimes(1));
    await settle();
    expect(beeperUpdate).toHaveBeenCalledTimes(1);
  });

  it("keeps ticking while there is a signal to pace beeps against", async () => {
    // The cadence comes from repeated calls at a steady level, so a loop that
    // parked on an unchanging signal would beep once and go quiet.
    beeperUpdate.mockClear();
    beeping({ confidence: 0.8, audioEnabled: true });
    await settle();
    expect(beeperUpdate.mock.calls.length).toBeGreaterThan(1);
  });

  it("wakes the parked loop when a signal arrives", async () => {
    beeperUpdate.mockClear();
    const view = beeping({ confidence: 0, audioEnabled: true });
    await waitFor(() => expect(beeperUpdate).toHaveBeenCalledTimes(1));
    view.rerender({ confidence: 0.9, audioEnabled: true });
    await waitFor(() =>
      expect(beeperUpdate).toHaveBeenLastCalledWith(0.9, expect.any(Number)),
    );
  });

  it("wakes the parked loop when the audio setting is turned on", async () => {
    beeperUpdate.mockClear();
    const view = beeping({ confidence: 0.9, audioEnabled: false });
    await waitFor(() => expect(beeperUpdate).toHaveBeenCalledTimes(1));
    view.rerender({ confidence: 0.9, audioEnabled: true });
    await waitFor(() =>
      expect(beeperUpdate).toHaveBeenLastCalledWith(0.9, expect.any(Number)),
    );
  });

  it("tears the audio graph down when its view unmounts", async () => {
    beeperDispose.mockClear();
    const view = beeping({ confidence: 0.8, audioEnabled: true });
    await waitFor(() => expect(beeperUpdate).toHaveBeenCalled());
    view.unmount();
    expect(beeperDispose).toHaveBeenCalled();
  });
});
