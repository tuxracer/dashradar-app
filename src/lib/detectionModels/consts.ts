import type { DetectionModel } from "./types";

/**
 * The model a build runs unless a developer picked otherwise, and the fallback
 * for a stored selection this build no longer recognizes. A build-time
 * constant on purpose: the app must run with empty storage, and the error
 * screen's revert action needs a target that always exists.
 */
export const DEFAULT_MODEL: DetectionModel = {
  id: "las-vegas-metro",
  owner: "tuxracer",
  slug: "las-vegas-metro-rfdetr-small",
  revision: "v3.8",
  file: "onnx/model_fp16.onnx",
};

/**
 * Every model the detector can be pointed at, in the order the picker lists
 * them. The first entry is what a build ships with and what an unrecognized
 * stored selection falls back to.
 *
 * An entry says which weights to fetch and nothing about what they contain.
 * The head width and the class labels are read off the loaded session and the
 * file's own stamped `names` map, so a checkpoint describes itself and no
 * table here can drift from the bytes it claims to describe.
 *
 * Adding an entry is still not free. `hudSignal` takes the max score across
 * every detection regardless of class, so every class a checkpoint names drives
 * the dial, the alert ring, and the beeper, with no per-class alert concept to
 * opt one out. INPUT_SIZE is also fixed at 512 across the whole capture path,
 * so a checkpoint that expects a different input size needs more than an entry
 * here.
 */
export const DETECTION_MODELS: readonly DetectionModel[] = [DEFAULT_MODEL];

/**
 * localStorage key the added models live under, as an array of DetectionModel
 * entries. Unprefixed, matching the app's other keys.
 */
export const STORED_MODELS_KEY = "models";

/**
 * How many models may be selected at once. One today: the worker loads a single
 * session and the load message names a single model. Raising this is the one
 * edit the picker needs to become multi-select, but it is not sufficient on its
 * own, since the worker protocol would have to carry more than one id.
 */
export const MAX_SELECTED_MODELS = 1;
