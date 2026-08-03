/**
 * One class the loaded checkpoint names. Derived at load from the `names` map
 * the export stamps into the weights, never typed into this repo, so the label
 * a box carries always comes from the file the box came from. It stays inside
 * the worker, which is the only place a logit index means anything.
 */
export type DetectionClass = {
  /**
   * This class's logit index in the model's head. Never 0, which every RF-DETR
   * head reserves as an unused background slot. Explicit rather than implied by
   * position, because a checkpoint may name only some of its head's slots.
   */
  index: number;
  label: string;
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
};

/**
 * A registry entry paired with what the session built from it turned out to
 * hold: the head width read off its `labels` output and the classes read off
 * its stamped `names` map. Nothing here is declared anywhere, so nothing here
 * can disagree with the weights it describes. The decode reads its stride and
 * its labels from this one value, which is what keeps a width from being
 * handed to a table it was never measured against.
 */
export type LoadedModel = DetectionModel & {
  headWidth: number;
  classes: readonly DetectionClass[];
};
