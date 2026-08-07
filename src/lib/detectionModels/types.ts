import { isArray, isNumber, isPlainObject, isString } from "remeda";

/**
 * One class the loaded checkpoint names, read at load from the `names` map its
 * export stamped in and never typed into this repo, so the label a box carries
 * comes from the file the box came from.
 */
export type DetectionClass = {
  /**
   * Logit index in the model's head, never 0 (the unused background slot).
   * Explicit rather than positional, since a checkpoint may name only some slots.
   */
  index: number;
  label: string;
};

/** Whether a runtime-unknown value is one class entry (see DetectionClass). */
export const isDetectionClass = (value: unknown): value is DetectionClass =>
  isPlainObject(value) && isNumber(value.index) && isString(value.label);

/** One selectable detection model; adding a model is adding an entry. */
export type DetectionModel = {
  /**
   * Stable id the settings selection is stored as. A revision bump keeps the id
   * so a stored selection survives a release; a different checkpoint gets a new
   * one, and an id is never reused.
   */
  id: string;
  /** Hugging Face account the repo is published under. */
  owner: string;
  /** Hugging Face repo name. */
  slug: string;
  /**
   * Revision tag the weights URL pins. Never "main": the model cache is
   * CacheFirst keyed on URL, so a mutable ref would sit behind an immutable
   * entry and a new model would never reach anyone. Absent for a plain-URL
   * model, where the pasted address is itself the pin.
   */
  revision?: string;
  /** Repo-relative path of the ONNX file (for example "onnx/model_fp16.onnx"). */
  file: string;
  /**
   * The exact address to fetch from, set only for a non-Hugging-Face model. Its
   * presence is what makes an entry a plain-URL one: `owner`, `slug`, and `file`
   * are then read off this address rather than used to build it.
   */
  weightsUrl?: string;
  /**
   * What the file named at the trial load, so the card can say what an entry
   * looks for without downloading it again. Display only: the decode always
   * reads classes off the session it is decoding, so this copy can never reach a
   * box. Absent on the shipping entry, whose revision moves under a stable id.
   */
  classes?: readonly DetectionClass[];
  /**
   * One plain sentence about what this checkpoint is for, so two models can be
   * told apart before either is run. Written here because the machine-readable
   * answer needs the file downloaded and runs to 80 words for a general-purpose
   * model. Prose only: nothing decodes it and no box is ever labelled from it,
   * and only the entries a build ships carry one.
   */
  summary?: string;
};

/**
 * Whether a string is an https URL. Plain http is refused rather than upgraded:
 * the page is served over https, so a mixed-content fetch would be blocked by
 * the browser anyway, and failing here says why instead of at download time.
 */
export const isHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Whether a runtime-unknown value is a usable model entry; they arrive from
 * localStorage and from worker messages. The `.onnx` check is the one content
 * rule, since everything else is proven by the trial load but a path that is not
 * an ONNX file can be rejected before a byte moves. The two shapes are told
 * apart by `weightsUrl` and each must be complete, or the entry resolves to a
 * URL nobody meant.
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
    (isString(value.weightsUrl)
      ? isHttpsUrl(value.weightsUrl) && value.revision === undefined
      : value.weightsUrl === undefined &&
        isString(value.revision) &&
        value.revision.length > 0) &&
    isString(value.file) &&
    value.file.endsWith(".onnx") &&
    (value.classes === undefined ||
      (isArray(value.classes) && value.classes.every(isDetectionClass)))
  );
};

/**
 * A registry entry paired with what the session built from it turned out to
 * hold, both measured rather than declared, so nothing here can disagree with
 * the weights. The decode takes its stride and its labels from this one value,
 * which is what keeps a width from meeting a table it was never measured against.
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
 * Why an add failed before the trial load: unusable URL, failed repo lookup, or
 * a file list that answers which file to load with none or several.
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
