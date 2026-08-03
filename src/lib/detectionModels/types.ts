import type { RoadCategory } from "@/types";

/**
 * One class a checkpoint's head can emit, with how the HUD names and colors
 * it. The decode reads it to name a box and the HUD reads it for the display
 * label and the box color, so the two can never disagree about what the model
 * detects.
 */
export type DetectionClass = {
  /**
   * This class's logit index in the model's head. Never 0, which every RF-DETR
   * head reserves as an unused background slot. Explicit rather than implied by
   * position, so a table can name two classes of a 91-wide COCO head without
   * enumerating the 88 it does not want.
   */
  index: number;
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
   * Width of this checkpoint's classification head, background slot included.
   * Declared rather than inferred, because a sparse class table no longer
   * implies it, and it is what pins a table to its checkpoint: a police table
   * naming logit 1, read against an accidentally loaded 91-wide COCO head,
   * would otherwise find `person` there and report it as POLICE on every frame.
   * Comes from the export's actual output shape.
   */
  headWidth: number;
  /**
   * The classes this build surfaces, each naming its own logit index. Need not
   * cover the head: a checkpoint trained on 80 classes can expose the six that
   * matter. A logit no entry names is never read.
   */
  classes: readonly DetectionClass[];
};
