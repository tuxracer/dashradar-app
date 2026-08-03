import { describe, expect, it } from "vitest";
import { pacingDelay } from "./index";
import { MAX_FRAME_INTERVAL_MS, MIN_FRAME_INTERVAL_MS } from "./consts";

/**
 * Share of wall time the GPU spends busy for a given round trip: the work
 * itself over the work plus the idle that follows it. This is what heats a
 * dash-mounted phone, so it is what these tests assert on rather than the
 * delay in isolation.
 */
const dutyCycle = (roundTripMs: number): number =>
  roundTripMs / (roundTripMs + pacingDelay(roundTripMs).delayMs);

describe("pacingDelay", () => {
  it("keeps a fast device's captures a full scan interval apart", () => {
    // The floor governs anything quick enough that resting the round trip
    // would return sooner than the interval allows.
    const roundTripMs = 120;
    const { delayMs, rule } = pacingDelay(roundTripMs);
    expect(rule).toBe("floor");
    expect(roundTripMs + delayMs).toBe(MIN_FRAME_INTERVAL_MS);
  });

  it("lightens the load as a device slows, rather than holding it steady", () => {
    // The regression this guards: a rest proportional to a fixed multiple of
    // the round trip gives a throttling phone more idle in absolute terms but
    // the same share of busy time, so the pacing never backs off the load that
    // caused the throttling. Every step deeper into the throttled band must
    // buy a strictly smaller share.
    const throttling = [600, 800, 1_000, 1_200, 1_400];
    const duties = throttling.map(dutyCycle);
    for (let i = 1; i < duties.length; i += 1) {
      expect(duties[i]).toBeLessThan(duties[i - 1]);
    }
  });

  it("never lets the GPU run busier than half the time", () => {
    for (let roundTripMs = 10; roundTripMs <= 4_000; roundTripMs += 10) {
      expect(dutyCycle(roundTripMs)).toBeLessThanOrEqual(0.5);
    }
  });

  it("keeps scanning often enough to be useful on the slowest devices", () => {
    // The ramp trades scan rate for heat, and unbounded that trade lands on a
    // detector too slow to catch what the car drives past.
    for (const roundTripMs of [2_000, 5_000, 20_000]) {
      expect(pacingDelay(roundTripMs).delayMs).toBeLessThanOrEqual(
        MAX_FRAME_INTERVAL_MS,
      );
    }
    expect(pacingDelay(20_000).rule).toBe("capped");
  });

  it("never scans more often as the round trip grows", () => {
    // The interval between captures, not the delay: under the floor rule a
    // longer round trip eats into the delay while the interval holds steady,
    // and only an interval that shortened would mean a slower device scanning
    // more often than a faster one.
    let previous = 0;
    for (let roundTripMs = 0; roundTripMs <= 3_000; roundTripMs += 25) {
      const interval = roundTripMs + pacingDelay(roundTripMs).delayMs;
      expect(interval).toBeGreaterThanOrEqual(previous);
      previous = interval;
    }
  });
});
