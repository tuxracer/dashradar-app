import { describe, expect, it } from "vitest";
import type { Detection, NormalizedBox } from "@/types";
import {
  buildHudModel,
  mapBoxToViewport,
  toRoadDetections,
  NEAR_AREA_FRACTION,
} from "@/lib/detection";

const box = (
  xmin: number,
  ymin: number,
  xmax: number,
  ymax: number,
): NormalizedBox => ({ xmin, ymin, xmax, ymax });

const detection = (overrides: Partial<Detection> = {}): Detection => ({
  label: "car",
  displayLabel: "CAR",
  category: "vehicle",
  score: 0.9,
  box: box(0.4, 0.5, 0.6, 0.8),
  ...overrides,
});

describe("toRoadDetections", () => {
  it("keeps road classes above the confidence threshold", () => {
    const result = toRoadDetections([
      { label: "car", score: 0.92, box: box(0.1, 0.1, 0.3, 0.3) },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].displayLabel).toBe("CAR");
    expect(result[0].category).toBe("vehicle");
  });

  it("drops non-road classes even with high scores", () => {
    const result = toRoadDetections([
      { label: "chair", score: 0.99, box: box(0.1, 0.1, 0.3, 0.3) },
    ]);
    expect(result).toHaveLength(0);
  });

  it("drops low-confidence detections", () => {
    const result = toRoadDetections([
      { label: "car", score: 0.4, box: box(0.1, 0.1, 0.3, 0.3) },
    ]);
    expect(result).toHaveLength(0);
  });

  it("maps traffic light to the SIGNAL display label", () => {
    const result = toRoadDetections([
      { label: "traffic light", score: 0.8, box: box(0.5, 0.1, 0.6, 0.3) },
    ]);
    expect(result[0].displayLabel).toBe("SIGNAL");
    expect(result[0].category).toBe("signal");
  });

  it("ignores malformed entries and non-arrays", () => {
    expect(toRoadDetections("junk")).toEqual([]);
    expect(
      toRoadDetections([{ label: "car", score: "high", box: {} }, 42]),
    ).toEqual([]);
  });
});

describe("buildHudModel", () => {
  it("picks the largest box as nearest and excludes it from others", () => {
    const small = detection({ box: box(0.1, 0.1, 0.2, 0.2) });
    const large = detection({ box: box(0.3, 0.3, 0.7, 0.9) });
    const hud = buildHudModel([small, large]);
    expect(hud.nearest).toBe(large);
    expect(hud.others).toEqual([small]);
  });

  it("flags NEAR only when the nearest box exceeds the area threshold", () => {
    // 0.4 x 0.6 = 0.24 area, well past the threshold
    const nearCar = detection({ box: box(0.3, 0.3, 0.7, 0.9) });
    expect(buildHudModel([nearCar]).near).toBe(true);

    // tiny box, far below the threshold
    const farCar = detection({ box: box(0.4, 0.4, 0.45, 0.45) });
    expect(buildHudModel([farCar]).near).toBe(false);
  });

  it("emits one blip per detection at the box center x", () => {
    const left = detection({ box: box(0.0, 0.5, 0.2, 0.7) });
    const right = detection({ box: box(0.6, 0.3, 1.0, 0.9) });
    const hud = buildHudModel([left, right]);
    expect(hud.blips).toHaveLength(2);
    expect(hud.blips.map((blip) => blip.x)).toContain(0.1);
    expect(hud.blips.map((blip) => blip.x)).toContain(0.8);
  });

  it("marks only the nearest blip as near, and only when NEAR", () => {
    const nearCar = detection({ box: box(0.3, 0.3, 0.7, 0.9) });
    const farBike = detection({
      label: "bicycle",
      displayLabel: "BIKE",
      category: "bike",
      box: box(0.0, 0.5, 0.1, 0.6),
    });
    const hud = buildHudModel([nearCar, farBike]);
    expect(hud.blips.filter((blip) => blip.near)).toHaveLength(1);

    const allFar = buildHudModel([farBike]);
    expect(allFar.blips.every((blip) => !blip.near)).toBe(true);
  });

  it("handles the empty frame", () => {
    const hud = buildHudModel([]);
    expect(hud.nearest).toBeUndefined();
    expect(hud.near).toBe(false);
    expect(hud.others).toEqual([]);
    expect(hud.blips).toEqual([]);
  });
});

describe("mapBoxToViewport", () => {
  it("maps 1:1 when video and viewport match", () => {
    const result = mapBoxToViewport(
      box(0.25, 0.25, 0.75, 0.75),
      { width: 1000, height: 500 },
      { width: 1000, height: 500 },
    );
    expect(result).toEqual({ left: 250, top: 125, width: 500, height: 250 });
  });

  it("crops horizontally when the viewport is taller than the video (portrait phone)", () => {
    // video 16:9 (1600x900) shown in a 900x1600 portrait viewport with cover:
    // scale = max(900/1600, 1600/900) = 16/9; displayed video = 2844.4x1600,
    // horizontal offset = (900 - 2844.4) / 2 = -972.2
    const result = mapBoxToViewport(
      box(0.5, 0.0, 1.0, 1.0),
      { width: 1600, height: 900 },
      { width: 900, height: 1600 },
    );
    expect(result.top).toBeCloseTo(0);
    expect(result.height).toBeCloseTo(1600);
    expect(result.left).toBeCloseTo(900 / 2 - 972.2 + 972.2); // center of viewport
    expect(result.left).toBeCloseTo(450, 0);
    expect(result.width).toBeCloseTo(2844.4 / 2, 0);
  });

  it("centers vertical crop when the viewport is wider than the video", () => {
    // video 4:3 (800x600) in a 1600x600 viewport: scale = 2, displayed 1600x1200,
    // vertical offset = (600 - 1200) / 2 = -300
    const result = mapBoxToViewport(
      box(0.0, 0.5, 1.0, 1.0),
      { width: 800, height: 600 },
      { width: 1600, height: 600 },
    );
    expect(result.left).toBeCloseTo(0);
    expect(result.width).toBeCloseTo(1600);
    expect(result.top).toBeCloseTo(-300 + 600);
    expect(result.height).toBeCloseTo(600);
  });
});

describe("NEAR_AREA_FRACTION", () => {
  it("is exceeded by a box exactly at the boundary", () => {
    const side = Math.sqrt(NEAR_AREA_FRACTION);
    const boundary = detection({ box: box(0, 0, side, side) });
    expect(buildHudModel([boundary]).near).toBe(true);
  });
});
