import {
  SCENE_CHANGE_THRESHOLD,
  SCENE_GRID,
  SCENE_SAMPLE_STRIDE,
} from "./consts";
import type { SceneComparison, SceneSignature } from "./types";

export * from "./consts";
export * from "./types";

/** Rec. 601 luma weights: the gate asks whether the picture changed to an eye. */
const LUMA_RED = 0.299;
const LUMA_GREEN = 0.587;
const LUMA_BLUE = 0.114;

/**
 * Reduce a frame to one mean luma per tile. Takes the ImageData the worker
 * already pulls off its input canvas, which is the whole reason the gate is
 * cheap: no capture, canvas, or readback of its own, just a pass over bytes that
 * were being read anyway, early enough that a skip avoids everything after it.
 */
export const sceneSignature = (imageData: ImageData): SceneSignature => {
  const { data, width, height } = imageData;
  const tiles = new Float32Array(SCENE_GRID * SCENE_GRID);
  const samples = new Uint32Array(SCENE_GRID * SCENE_GRID);
  for (let y = 0; y < height; y += SCENE_SAMPLE_STRIDE) {
    const row =
      Math.min(SCENE_GRID - 1, Math.floor((y * SCENE_GRID) / height)) *
      SCENE_GRID;
    for (let x = 0; x < width; x += SCENE_SAMPLE_STRIDE) {
      const pixel = (y * width + x) * 4;
      const tile =
        row + Math.min(SCENE_GRID - 1, Math.floor((x * SCENE_GRID) / width));
      tiles[tile] +=
        LUMA_RED * data[pixel] +
        LUMA_GREEN * data[pixel + 1] +
        LUMA_BLUE * data[pixel + 2];
      samples[tile] += 1;
    }
  }
  for (let tile = 0; tile < tiles.length; tile += 1) {
    if (samples[tile] > 0) {
      tiles[tile] /= samples[tile];
    }
  }
  return tiles;
};

/**
 * Whether the scene moved enough since the last scanned frame to be worth
 * another inference. The verdict is the largest single tile's change, never the
 * average: averaging answers how much of the picture changed, when what matters
 * is whether anything did. The frame-wide shift is subtracted first, so an
 * auto-exposure correction moving every tile alike does not read as movement;
 * anything that did arrive departs from that shift rather than following it.
 */
export const compareScenes = (
  previous: SceneSignature,
  next: SceneSignature,
): SceneComparison => {
  let total = 0;
  for (let tile = 0; tile < next.length; tile += 1) {
    total += next[tile] - previous[tile];
  }
  const shift = total / next.length;
  let delta = 0;
  for (let tile = 0; tile < next.length; tile += 1) {
    const moved = Math.abs(next[tile] - previous[tile] - shift);
    if (moved > delta) {
      delta = moved;
    }
  }
  return { changed: delta >= SCENE_CHANGE_THRESHOLD, delta };
};
