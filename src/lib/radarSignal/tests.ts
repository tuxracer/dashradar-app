import { describe, expect, it } from "vitest";
import { buildHudModel } from "@/lib/detection";
import type { HudModel } from "@/lib/detection";
import type { Detection } from "@/types";
import {
  contactDirection,
  decayPeak,
  hudScore,
  hudSignal,
  initialMeterState,
  litSegments,
  signalColor,
  signalFromScore,
  stepMeter,
  DECAY_PER_SEC,
  SEGMENT_COUNT,
  SIGNAL_FLOOR,
} from "@/lib/radarSignal";

const det = (score: number): Detection => ({
  label: "police",
  score,
  box: { xmin: 0.4, ymin: 0.4, xmax: 0.6, ymax: 0.6 },
});

/**
 * A HudModel built through the real buildHudModel, so these tests exercise
 * the actual selection rule rather than a hand-set one.
 */
const hudOf = (detections: Detection[]): HudModel => buildHudModel(detections);

/** The score halfway up the [SIGNAL_FLOOR, 1] band the ladder stretches over. */
const bandMidpoint = SIGNAL_FLOOR + (1 - SIGNAL_FLOOR) / 2;

const rgbChannels = (color: string): [number, number, number] => {
  const match = color.match(/rgb\((\d+), (\d+), (\d+)\)/);
  if (!match) {
    throw new Error(`unexpected color: ${color}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

describe("hudSignal", () => {
  it("returns 0 for an undefined HUD", () => {
    expect(hudSignal(undefined)).toBe(0);
  });

  it("returns 0 when there are no detections", () => {
    expect(hudSignal(hudOf([]))).toBe(0);
  });

  it("returns 0 for a score at the floor", () => {
    expect(hudSignal(hudOf([det(SIGNAL_FLOOR)]))).toBe(0);
  });

  it("maps a full-confidence score to 1", () => {
    expect(hudSignal(hudOf([det(1)]))).toBe(1);
  });

  it("remaps the midpoint of the [floor, 1] band to 0.5", () => {
    expect(hudSignal(hudOf([det(bandMidpoint)]))).toBeCloseTo(0.5, 5);
  });

  it("takes the max score across the frame's detections", () => {
    // The strongest detection sits between two weaker ones, so a meter reading
    // the first or the last would land somewhere other than the midpoint.
    expect(
      hudSignal(
        hudOf([det(SIGNAL_FLOOR), det(bandMidpoint), det(SIGNAL_FLOOR)]),
      ),
    ).toBeCloseTo(0.5, 5);
  });
});

describe("hudScore", () => {
  it("returns 0 for an undefined HUD", () => {
    expect(hudScore(undefined)).toBe(0);
  });

  it("returns 0 when there are no detections", () => {
    expect(hudScore(hudOf([]))).toBe(0);
  });

  it("passes a score through without the floor remap", () => {
    // The whole point of the raw readout: the band's midpoint reads as its own
    // score, not the 0.5 the meter's [floor, 1] stretch turns it into.
    expect(hudScore(hudOf([det(bandMidpoint)]))).toBe(bandMidpoint);
    expect(hudScore(hudOf([det(SIGNAL_FLOOR)]))).toBe(SIGNAL_FLOOR);
  });

  it("takes the max score across the frame's detections", () => {
    expect(hudScore(hudOf([det(0.6), det(0.9), det(0.55)]))).toBe(0.9);
  });

  it("reports the most confident detection, not the largest box", () => {
    // A small, high-scoring box is not what the readout reports: it must
    // report the model's best score in the frame regardless of box size.
    expect(hudScore(hudOf([det(0.55), det(0.95)]))).toBe(0.95);
  });
});

describe("decayPeak", () => {
  it("snaps up instantly to a higher raw value", () => {
    expect(decayPeak(0.2, 0.9, 0.1)).toBe(0.9);
  });

  it("decays a held peak by DECAY_PER_SEC * dt when raw is lower", () => {
    expect(decayPeak(1, 0, 0.5)).toBeCloseTo(1 - DECAY_PER_SEC * 0.5, 5);
  });

  it("clamps the decayed value at 0", () => {
    expect(decayPeak(0.1, 0, 1)).toBe(0);
  });

  it("holds most of a peak across a two-second gap between detection results", () => {
    // Detection runs at most once per second (MIN_FRAME_INTERVAL_MS), and slow
    // devices' rest ratio can stretch the gap to two seconds or more, so one
    // low-scoring result must not let the meter collapse before the next
    // result can correct it. Guards against re-tuning DECAY_PER_SEC so fast
    // that the peak-hold stops bridging consecutive results.
    expect(decayPeak(0.8, 0.2, 2)).toBeGreaterThan(0.45);
  });
});

describe("litSegments", () => {
  it("lights no segments at level 0", () => {
    expect(litSegments(0, SEGMENT_COUNT)).toBe(0);
  });

  it("lights every segment at level 1", () => {
    expect(litSegments(1, SEGMENT_COUNT)).toBe(SEGMENT_COUNT);
  });

  it("lights half the segments at level 0.5", () => {
    expect(litSegments(0.5, 14)).toBe(7);
  });
});

describe("signalColor", () => {
  it("is green-dominant at a low level", () => {
    const [r, g] = rgbChannels(signalColor(0));
    expect(g).toBeGreaterThan(r);
  });

  it("is red-dominant at a high level", () => {
    const [r, g] = rgbChannels(signalColor(1));
    expect(r).toBeGreaterThan(g);
  });

  it("returns distinct colors across low, mid, and high", () => {
    expect(
      new Set([signalColor(0), signalColor(0.5), signalColor(1)]).size,
    ).toBe(3);
  });
});

describe("signalFromScore", () => {
  it("maps scores at or below the floor to zero", () => {
    expect(signalFromScore(SIGNAL_FLOOR)).toBe(0);
    expect(signalFromScore(0)).toBe(0);
  });

  it("remaps the floor-to-one band onto zero-to-one", () => {
    const mid = SIGNAL_FLOOR + (1 - SIGNAL_FLOOR) / 2;
    expect(signalFromScore(mid)).toBeCloseTo(0.5);
    expect(signalFromScore(1)).toBe(1);
  });
});

describe("contactDirection", () => {
  const boxAtCenterX = (centerX: number) => ({
    xmin: centerX - 0.05,
    ymin: 0.4,
    xmax: centerX + 0.05,
    ymax: 0.6,
  });

  it("reads a left-third contact as left", () => {
    expect(contactDirection(boxAtCenterX(0.2))).toBe("left");
  });

  it("reads a middle-third contact as ahead", () => {
    expect(contactDirection(boxAtCenterX(0.5))).toBe("ahead");
  });

  it("reads a right-third contact as right", () => {
    expect(contactDirection(boxAtCenterX(0.8))).toBe("right");
  });
});

describe("stepMeter", () => {
  const step = (
    state = initialMeterState(),
    inputs: Partial<Parameters<typeof stepMeter>[1]> = {},
    dtSec = 0.016,
  ) =>
    stepMeter(
      state,
      {
        signal: 0,
        detectedLabel: undefined,
        contactPresent: false,
        ...inputs,
      },
      dtSec,
    );

  it("snaps the level up to a new signal and decays it once the signal drops", () => {
    const risen = step(initialMeterState(), { signal: 0.9 });
    expect(risen.display.level).toBe(0.9);

    const decayed = step(risen.state, { signal: 0 });
    expect(decayed.display.level).toBeLessThan(0.9);
    expect(decayed.display.level).toBeGreaterThan(0);
  });

  it("holds the detected label through the decay tail", () => {
    const live = step(initialMeterState(), {
      signal: 0.9,
      detectedLabel: "police",
    });
    expect(live.display.heldLabel).toBe("police");

    // The detection clears while the dial still shows a number: the label
    // must survive rather than snapping away mid-decay.
    const coasting = step(live.state, { signal: 0 });
    expect(coasting.display.level).toBeGreaterThan(0);
    expect(coasting.display.heldLabel).toBe("police");
  });

  it("releases the held label once the meter fully decays to zero", () => {
    const live = step(initialMeterState(), {
      signal: 0.5,
      detectedLabel: "police",
    });
    // A long step decays any level to zero.
    const drained = step(live.state, { signal: 0 }, 60);
    expect(drained.display.level).toBe(0);
    expect(drained.display.heldLabel).toBeUndefined();
  });

  it("adopts a new label the moment a different detection is live", () => {
    const first = step(initialMeterState(), {
      signal: 0.9,
      detectedLabel: "police",
    });
    const second = step(first.state, {
      signal: 0.9,
      detectedLabel: "sheriff",
    });
    expect(second.display.heldLabel).toBe("sheriff");
  });

  it("shows the contact only while one exists and the meter is live", () => {
    const live = step(initialMeterState(), {
      signal: 0.9,
      contactPresent: true,
    });
    expect(live.display.contactShown).toBe(true);

    // The card follows the decay tail: still shown while the level drains...
    const coasting = step(live.state, { signal: 0, contactPresent: true });
    expect(coasting.display.contactShown).toBe(true);

    // ...and gone at a zero meter, or when no contact exists at any level.
    const drained = step(
      coasting.state,
      { signal: 0, contactPresent: true },
      60,
    );
    expect(drained.display.contactShown).toBe(false);
    expect(
      step(initialMeterState(), { signal: 0.9 }).display.contactShown,
    ).toBe(false);
  });
});
