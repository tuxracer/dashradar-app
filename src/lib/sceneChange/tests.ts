import { describe, expect, it } from "vitest";
import { compareScenes, sceneSignature } from "./index";
import { SCENE_CHANGE_THRESHOLD } from "./consts";

const SIZE = 512;

/**
 * A flat gray frame, optionally painted on. `paint` returns the luma to use at
 * a pixel, or undefined to leave the background. Built as a plain object rather
 * than through the ImageData constructor because the module reads only these
 * three fields and jsdom's canvas support is not what is under test.
 */
const frame = (
  background: number,
  paint?: (x: number, y: number) => number | undefined,
): ImageData => {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const value = paint?.(x, y) ?? background;
      const pixel = (y * SIZE + x) * 4;
      data[pixel] = value;
      data[pixel + 1] = value;
      data[pixel + 2] = value;
      data[pixel + 3] = 255;
    }
  }
  return { data, width: SIZE, height: SIZE } as ImageData;
};

/** A square of `side` pixels at (left, top) painted to `value`. */
const square =
  (left: number, top: number, side: number, value: number) =>
  (x: number, y: number) =>
    x >= left && x < left + side && y >= top && y < top + side
      ? value
      : undefined;

const compare = (a: ImageData, b: ImageData) =>
  compareScenes(sceneSignature(a), sceneSignature(b));

describe("the scene-change gate", () => {
  it("holds a frame that has not moved", () => {
    // The case the whole feature exists for: a car stopped at a light pointing
    // the camera at a picture that is not changing.
    expect(compare(frame(90), frame(90)).changed).toBe(false);
  });

  it("trips on an object far too small to move the frame's average", () => {
    // The reason the comparison is per tile rather than frame-wide. A patrol
    // car at the distance worth warning about covers a few dozen pixels of the
    // model's input, and a statistic that averages the whole frame cannot tell
    // that apart from noise. Both assertions matter: the gate has to trip, and
    // the frame-wide average it would have been compared against has to be
    // below the line, or the test would pass under either design.
    const before = frame(90);
    const after = frame(90, square(100, 100, 12, 150));
    expect(compare(before, after).changed).toBe(true);

    const painted = 12 * 12;
    const frameWideShift = ((150 - 90) * painted) / (SIZE * SIZE);
    expect(frameWideShift).toBeLessThan(SCENE_CHANGE_THRESHOLD);
  });

  it("holds through an exposure correction that moves the whole picture", () => {
    // Auto-exposure and white balance shift every tile by about the same
    // amount and mean that nothing arrived, so a gate that read them as
    // movement would scan constantly on a slowly brightening evening road.
    expect(compare(frame(90), frame(97)).changed).toBe(false);
  });

  it("still sees an arrival that happens during an exposure correction", () => {
    // The guard on the compensation above: removing the frame-wide shift must
    // not remove what departs from it. Nothing here can pass by accident, since
    // the previous test fixes the same exposure change as a non-event.
    const before = frame(90);
    const after = frame(97, square(100, 100, 12, 150));
    expect(compare(before, after).changed).toBe(true);
  });

  it("holds through per-pixel sensor grain", () => {
    // High-gain noise on a night drive is per pixel and unbiased, so averaging
    // a tile's worth of it has to land well inside the threshold. A gate that
    // tripped on grain would skip nothing and cost the pass for free.
    let seed = 7;
    const grain = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return 90 + ((seed % 21) - 10);
    };
    expect(compare(frame(90), frame(90, grain)).changed).toBe(false);
  });

  it("reports the measured shift whichever way it decided", () => {
    // The number the threshold is tuned against on a device, so it has to be
    // present on both sides of the decision rather than only when it trips.
    const still = compare(frame(90), frame(90));
    expect(still.changed).toBe(false);
    expect(still.delta).toBeLessThan(SCENE_CHANGE_THRESHOLD);

    const moved = compare(frame(90), frame(90, square(100, 100, 40, 200)));
    expect(moved.changed).toBe(true);
    expect(moved.delta).toBeGreaterThanOrEqual(SCENE_CHANGE_THRESHOLD);
  });
});
