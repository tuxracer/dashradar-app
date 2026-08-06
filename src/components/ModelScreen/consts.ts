import type { AddModelErrorCode } from "@/lib/detectionModels";

/**
 * How long a removed row is kept mounted so it can collapse out, matched to
 * the `row-out` keyframes in globals.css. Under reduced motion the row is
 * dropped immediately instead, since there is no animation to wait for.
 */
export const ROW_EXIT_MS = 300;

/**
 * Gap between one row's entrance and the next, the same staggering the intro
 * and unsupported screens use. Small enough that a long file list finishes
 * arriving well before anyone could act on it.
 */
export const ROW_ENTER_STAGGER_MS = 45;

/** Shown when a commit could not be written, so nothing was applied. */
export const COMMIT_FAILED_MESSAGE =
  "Could not save the model selection, so nothing changed.";

/** Shown when a registered model could not be written to storage. */
export const ADD_FAILED_MESSAGE =
  "Could not save the model, so it was not added.";

/** Prompt above the file list when a repo holds more than one checkpoint. */
export const CHOOSE_FILE_MESSAGE = "That repo has more than one model file.";

/** Status line for a checkpoint whose file names no classes. */
export const GENERIC_CLASSES_MESSAGE =
  "Names no classes; it will run with generic labels.";

/** Add-flow copy for the URL stories, keyed by AddModelErrorCode. */
export const ADD_ERROR_COPY: Readonly<Record<AddModelErrorCode, string>> = {
  INVALID_URL:
    "Paste a Hugging Face model page, or a link straight to an .onnx file.",
  REPO_LOOKUP_FAILED: "Could not look up that repo on Hugging Face.",
  NO_ONNX_FILE: "That repo has no .onnx file.",
  // Only reached when the follow-up listing call fails, since a repo with
  // several files otherwise opens the picker instead of failing.
  AMBIGUOUS_ONNX_FILE:
    "That repo has more than one .onnx file, and the list could not be loaded.",
};
