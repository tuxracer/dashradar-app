import { describe, expect, it } from "vitest";
import type { HudModel } from "@/lib/detection";
import type { Detection } from "@/types";
import {
  contactDirection,
  decayPeak,
  hudSignal,
  litSegments,
  signalColor,
  signalFromScore,
  DECAY_PER_SEC,
  SEGMENT_COUNT,
  SIGNAL_FLOOR,
} from "@/lib/radarSignal";

const det = (score: number): Detection => ({
  label: "police",
  displayLabel: "POLICE",
  category: "vehicle",
  score,
  box: { xmin: 0.4, ymin: 0.4, xmax: 0.6, ymax: 0.6 },
});

const hudOf = (
  nearest: Detection | undefined,
  others: Detection[] = [],
): HudModel => ({ nearest, near: false, others, blips: [] });

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
    expect(hudSignal(hudOf(undefined, []))).toBe(0);
  });

  it("returns 0 for a score at the floor", () => {
    expect(hudSignal(hudOf(det(0.7)))).toBe(0);
  });

  it("maps a full-confidence score to 1", () => {
    expect(hudSignal(hudOf(det(1)))).toBe(1);
  });

  it("remaps the midpoint of the [floor, 1] band to 0.5", () => {
    expect(hudSignal(hudOf(det(0.85)))).toBeCloseTo(0.5, 5);
  });

  it("takes the max score across nearest and others", () => {
    expect(hudSignal(hudOf(det(0.6), [det(0.94), det(0.55)]))).toBeCloseTo(
      0.8,
      5,
    );
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

  it("holds most of a peak across a one-second gap between detection results", () => {
    // Detection runs at most once per second (MIN_FRAME_INTERVAL_MS), so one
    // low-scoring result must not let the meter collapse before the next
    // result can correct it. Guards against re-tuning DECAY_PER_SEC so fast
    // that the peak-hold stops bridging consecutive results.
    expect(decayPeak(0.8, 0.2, 1)).toBeGreaterThan(0.6);
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
