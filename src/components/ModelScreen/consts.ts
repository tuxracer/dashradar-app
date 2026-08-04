import type { AddModelErrorCode } from "@/lib/detectionModels";

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
    "Not a Hugging Face model URL. Paste a repo page or a link to an .onnx file.",
  REPO_LOOKUP_FAILED: "Could not look up that repo on Hugging Face.",
  NO_ONNX_FILE: "That repo has no .onnx file.",
  // Only reached when the follow-up listing call fails, since a repo with
  // several files otherwise opens the picker instead of failing.
  AMBIGUOUS_ONNX_FILE:
    "That repo has more than one .onnx file, and the list could not be loaded.",
};
