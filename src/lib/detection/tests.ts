import { describe, expect, it } from "vitest";
import type { Detection, NormalizedBox } from "@/types";
import {
  buildHudModel,
  CONFIDENCE_THRESHOLD,
  containScale,
  mapBoxToViewport,
  scanRegionBox,
  enrichDetections,
} from "@/lib/detection";
import { ZOOM_2X } from "@/workers/detection/consts";
import { centerCropRegion } from "@/workers/detection/inference";

const box = (
  xmin: number,
  ymin: number,
  xmax: number,
  ymax: number,
): NormalizedBox => ({ xmin, ymin, xmax, ymax });

const detection = (overrides: Partial<Detection> = {}): Detection => ({
  label: "police",
  score: 0.9,
  box: box(0.4, 0.5, 0.6, 0.8),
  ...overrides,
});

describe("enrichDetections", () => {
  it("keeps whatever class the model reported", () => {
    const result = enrichDetections([
      { label: "bicycle", score: 0.92, box: box(0.1, 0.1, 0.3, 0.3) },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("bicycle");
  });

  it("drops low-confidence detections", () => {
    const result = enrichDetections(
      [
        {
          label: "police",
          score: CONFIDENCE_THRESHOLD - 0.1,
          box: box(0.1, 0.1, 0.3, 0.3),
        },
      ],
      undefined,
    );
    expect(result).toHaveLength(0);
  });

  it("keeps a detection just above the threshold", () => {
    const result = enrichDetections(
      [
        {
          label: "police",
          score: CONFIDENCE_THRESHOLD + 0.1,
          box: box(0.1, 0.1, 0.3, 0.3),
        },
      ],
      undefined,
    );
    expect(result).toHaveLength(1);
  });

  it("ignores malformed entries and non-arrays", () => {
    expect(enrichDetections("junk")).toEqual([]);
    expect(
      enrichDetections([{ label: "police", score: "high", box: {} }, 42]),
    ).toEqual([]);
  });

  it("keeps a detection below the default threshold when given a lower one", () => {
    const result = enrichDetections(
      [{ label: "police", score: 0.3, box: box(0.1, 0.1, 0.3, 0.3) }],
      0.2,
    );
    expect(result).toHaveLength(1);
  });

  it("drops a detection below the explicit threshold", () => {
    const result = enrichDetections(
      [{ label: "police", score: 0.3, box: box(0.1, 0.1, 0.3, 0.3) }],
      0.4,
    );
    expect(result).toHaveLength(0);
  });

  it("filters at the default threshold with no threshold argument", () => {
    const result = enrichDetections(
      [
        {
          label: "police",
          score: CONFIDENCE_THRESHOLD - 0.1,
          box: box(0.1, 0.1, 0.3, 0.3),
        },
      ],
      undefined,
    );
    expect(result).toHaveLength(0);
  });
});

describe("buildHudModel", () => {
  it("has no top on an empty frame", () => {
    expect(buildHudModel([]).top).toBeUndefined();
  });

  it("picks the highest-scoring detection as top, independent of size", () => {
    const bigButUnsure = detection({
      box: box(0.3, 0.3, 0.9, 0.9),
      score: 0.55,
    });
    const smallButSure = detection({
      box: box(0.1, 0.1, 0.2, 0.2),
      score: 0.95,
    });
    const hud = buildHudModel([bigButUnsure, smallButSure]);
    expect(hud.top).toBe(smallButSure);
  });

  it("makes a single detection the top", () => {
    const only = detection();
    const hud = buildHudModel([only]);
    expect(hud.top).toBe(only);
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

  it("letterboxes when the viewport is taller than the video (portrait phone)", () => {
    // video 16:9 (1600x900) shown in a 900x1600 portrait viewport with contain:
    // scale = min(900/1600, 1600/900) = 0.5625; displayed video = 900x506.25,
    // vertical offset = (1600 - 506.25) / 2 = 546.875
    const result = mapBoxToViewport(
      box(0.5, 0.0, 1.0, 1.0),
      { width: 1600, height: 900 },
      { width: 900, height: 1600 },
    );
    expect(result.left).toBeCloseTo(450);
    expect(result.width).toBeCloseTo(450);
    expect(result.top).toBeCloseTo(546.875);
    expect(result.height).toBeCloseTo(506.25);
  });

  it("pillarboxes when the viewport is wider than the video", () => {
    // video 4:3 (800x600) in a 1600x600 viewport: scale = min(2, 1) = 1,
    // displayed 800x600, horizontal offset = (1600 - 800) / 2 = 400
    const result = mapBoxToViewport(
      box(0.0, 0.5, 1.0, 1.0),
      { width: 800, height: 600 },
      { width: 1600, height: 600 },
    );
    expect(result.left).toBeCloseTo(400);
    expect(result.width).toBeCloseTo(800);
    expect(result.top).toBeCloseTo(300);
    expect(result.height).toBeCloseTo(300);
  });

  it("keeps a box at the frame's edge on screen", () => {
    const result = mapBoxToViewport(
      box(0.0, 0.0, 0.1, 1.0),
      { width: 1600, height: 900 },
      { width: 900, height: 1600 },
    );
    expect(result.left).toBeGreaterThanOrEqual(0);
    expect(result.left + result.width).toBeLessThanOrEqual(900);
  });
});

describe("containScale", () => {
  it("returns the smaller of the width and height ratios (fit, then letterbox)", () => {
    // 800/1280 = 0.625, 600/720 = 0.833 -> width ratio wins
    expect(
      containScale({ width: 1280, height: 720 }, { width: 800, height: 600 }),
    ).toBeCloseTo(800 / 1280);
  });

  it("scales up when the viewport is larger than the video", () => {
    expect(
      containScale({ width: 640, height: 480 }, { width: 1280, height: 960 }),
    ).toBeCloseTo(2);
  });
});

describe("scanRegionBox", () => {
  it("covers the whole frame for a square frame at 1x", () => {
    const result = scanRegionBox({ width: 512, height: 512 });
    expect(result).toEqual(box(0, 0, 1, 1));
  });

  it("insets horizontally for a landscape frame at 1x", () => {
    // 1280x720: the centered square is 720 wide, leaving 280 either side.
    const result = scanRegionBox({ width: 1280, height: 720 });
    expect(result.xmin).toBeCloseTo(280 / 1280);
    expect(result.xmax).toBeCloseTo(1000 / 1280);
    expect(result.ymin).toBeCloseTo(0);
    expect(result.ymax).toBeCloseTo(1);
  });

  it("halves the region's side at 2x", () => {
    // 1024x1024 at 2x: a 512 square centered, so a quarter inset all round.
    const result = scanRegionBox({ width: 1024, height: 1024 }, ZOOM_2X);
    expect(result.xmin).toBeCloseTo(0.25);
    expect(result.ymin).toBeCloseTo(0.25);
    expect(result.xmax).toBeCloseTo(0.75);
    expect(result.ymax).toBeCloseTo(0.75);
  });

  it("stays centered on both axes for a portrait frame at 2x", () => {
    // 720x1280 at 2x: side 360, so 180 either side horizontally and 460
    // above and below.
    const result = scanRegionBox({ width: 720, height: 1280 }, ZOOM_2X);
    expect(result.xmin).toBeCloseTo(180 / 720);
    expect(result.xmax).toBeCloseTo(540 / 720);
    expect(result.ymin).toBeCloseTo(460 / 1280);
    expect(result.ymax).toBeCloseTo(820 / 1280);
  });

  it("matches what the worker crops, so the outline cannot drift", () => {
    const frame = { width: 1600, height: 900 };
    const region = centerCropRegion(frame.width, frame.height, ZOOM_2X);
    const result = scanRegionBox(frame, ZOOM_2X);
    expect(result.xmin * frame.width).toBeCloseTo(region.sx);
    expect(result.ymin * frame.height).toBeCloseTo(region.sy);
    expect((result.xmax - result.xmin) * frame.width).toBeCloseTo(region.side);
  });
});
