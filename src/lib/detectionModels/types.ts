import type { RoadCategory } from "@/types";

/**
 * One class a checkpoint's head can emit, with how the HUD names and colors
 * it. The decode reads it to name a box and the HUD reads it for the display
 * label and the box color, so the two can never disagree about what the model
 * detects.
 */
export type DetectionClass = {
  label: string;
  displayLabel: string;
  category: RoadCategory;
};

/**
 * One selectable detection model: everything that ships with a checkpoint.
 * Adding a model is a matter of adding an entry, which is the point of this
 * type existing.
 */
export type DetectionModel = {
  /**
   * Stable id the settings selection is stored as. Bumping an entry's revision
   * in place keeps the id, so a stored selection survives a routine model
   * release. A genuinely different checkpoint gets a new id instead, and an id
   * is never reused for a different checkpoint.
   */
  id: string;
  /** Hugging Face repo name, under the MODEL_OWNER account. */
  slug: string;
  /**
   * Revision tag the weights URL pins. Never "main": the Workbox model cache is
   * CacheFirst keyed on URL, so a mutable ref would sit behind an immutable
   * cache entry and a new model would never reach anyone.
   */
  revision: string;
  /** ONNX file within the repo's onnx/ directory. */
  file: string;
  /**
   * Every class this checkpoint's head emits, in head-index order: entry i is
   * class logit i + 1 in the model's output, since logit 0 is an unused
   * background slot. The array's length has to match the model's head width,
   * which decodeDetections checks on every frame.
   */
  classes: readonly DetectionClass[];
};
