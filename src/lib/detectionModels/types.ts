import { isPlainObject, isString } from "remeda";

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
  /** Hugging Face account the repo is published under. */
  owner: string;
  /** Hugging Face repo name. */
  slug: string;
  /**
   * Revision tag the weights URL pins. Never "main": the Workbox model cache is
   * CacheFirst keyed on URL, so a mutable ref would sit behind an immutable
   * cache entry and a new model would never reach anyone.
   */
  revision: string;
  /** Repo-relative path of the ONNX file (for example "onnx/model_fp16.onnx"). */
  file: string;
};

/**
 * Whether a runtime-unknown value is a usable model entry. Entries arrive from
 * localStorage and from the worker load message, so shape is enforced here
 * rather than assumed. The `.onnx` check is the one content rule: everything
 * else about a file is proven by the trial load, but a path that is not even
 * an ONNX file can be rejected before a byte moves.
 */
export const isDetectionModel = (value: unknown): value is DetectionModel => {
  return (
    isPlainObject(value) &&
    isString(value.id) &&
    value.id.length > 0 &&
    isString(value.owner) &&
    value.owner.length > 0 &&
    isString(value.slug) &&
    value.slug.length > 0 &&
    isString(value.revision) &&
    value.revision.length > 0 &&
    isString(value.file) &&
    value.file.endsWith(".onnx")
  );
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

/** Parsed identity of a pasted Hugging Face URL, before any pinning. */
export type ParsedModelUrl = {
  owner: string;
  slug: string;
  /** Undefined when the URL names no revision (a bare repo page). */
  revision?: string;
  /** Repo-relative path to the .onnx file; undefined for a bare repo page. */
  file?: string;
};

/**
 * Why an add failed before the trial load: the pasted text is not a usable
 * Hugging Face URL, the repo lookup failed (missing repo, network, rate
 * limit), or the repo's file list settles the question of which file to load
 * in the wrong way (none, or several).
 */
export type AddModelErrorCode =
  | "INVALID_URL"
  | "REPO_LOOKUP_FAILED"
  | "NO_ONNX_FILE"
  | "AMBIGUOUS_ONNX_FILE";

/** Why a pasted Hugging Face URL could not be turned into a loadable model. */
export class AddModelError extends Error {
  readonly code: AddModelErrorCode;
  /** Extra context for the UI, like the candidate files of an ambiguous repo. */
  readonly detail?: string;

  constructor(code: AddModelErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "AddModelError";
    this.code = code;
    this.detail = detail;
  }
}

/** Whether a runtime-unknown value is an AddModelError. */
export const isAddModelError = (error: unknown): error is AddModelError =>
  error instanceof AddModelError;
