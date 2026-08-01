import { describe, expect, it } from "vitest";
import { createScanClock, toBucketedMinutes } from "@/lib/scanClock";

const MINUTE = 60_000;

/** A clock whose time only moves when the test says so. */
const controlledClock = () => {
  let now = 0;
  const clock = createScanClock(() => now);
  return { clock, advance: (ms: number) => (now += ms) };
};

describe("toBucketedMinutes", () => {
  it("reads anything under a minute as zero", () => {
    expect(toBucketedMinutes(0)).toBe(0);
    expect(toBucketedMinutes(MINUTE - 1)).toBe(0);
  });

  it("snaps down to the bucket below, never up", () => {
    expect(toBucketedMinutes(4 * MINUTE)).toBe(2);
    expect(toBucketedMinutes(59 * MINUTE)).toBe(45);
  });

  it("lands exactly on a mark it reaches", () => {
    expect(toBucketedMinutes(MINUTE)).toBe(1);
    expect(toBucketedMinutes(30 * MINUTE)).toBe(30);
  });

  it("tops out rather than growing without bound", () => {
    expect(toBucketedMinutes(8 * 60 * MINUTE)).toBe(240);
  });
});

describe("createScanClock", () => {
  it("counts only the stretches the pump was running", () => {
    const { clock, advance } = controlledClock();
    clock.start();
    advance(10 * MINUTE);
    clock.stop();
    // Settings open, page hidden, camera stalled: not drive time.
    advance(60 * MINUTE);
    clock.start();
    advance(5 * MINUTE);
    expect(clock.elapsedMs()).toBe(15 * MINUTE);
  });

  it("includes the stretch in progress", () => {
    const { clock, advance } = controlledClock();
    clock.start();
    advance(3 * MINUTE);
    expect(clock.elapsedMs()).toBe(3 * MINUTE);
  });

  // The running-window effect can re-run without an intervening cleanup under
  // StrictMode; a second start must not throw away the stretch in progress.
  it("keeps the first start when started twice", () => {
    const { clock, advance } = controlledClock();
    clock.start();
    advance(2 * MINUTE);
    clock.start();
    advance(MINUTE);
    expect(clock.elapsedMs()).toBe(3 * MINUTE);
  });

  it("ignores a stop with nothing running", () => {
    const { clock, advance } = controlledClock();
    clock.start();
    advance(MINUTE);
    clock.stop();
    clock.stop();
    advance(MINUTE);
    expect(clock.elapsedMs()).toBe(MINUTE);
  });

  it("hands out each stretch once, so the reports sum to the total", () => {
    const { clock, advance } = controlledClock();
    clock.start();
    advance(4 * MINUTE);
    expect(clock.takeUnreportedMs()).toBe(4 * MINUTE);
    advance(6 * MINUTE);
    expect(clock.takeUnreportedMs()).toBe(6 * MINUTE);
    expect(clock.elapsedMs()).toBe(10 * MINUTE);
  });

  it("reports nothing when nothing has been scanned since the last report", () => {
    const { clock, advance } = controlledClock();
    clock.start();
    advance(MINUTE);
    clock.takeUnreportedMs();
    expect(clock.takeUnreportedMs()).toBe(0);
  });

  it("holds back a stretch under the minimum instead of consuming it", () => {
    const { clock, advance } = controlledClock();
    clock.start();
    advance(400);
    expect(clock.takeUnreportedMs(1_000)).toBe(0);
    // The held-back sliver is still there to be counted, not discarded.
    advance(700);
    expect(clock.takeUnreportedMs(1_000)).toBe(1_100);
  });
});
