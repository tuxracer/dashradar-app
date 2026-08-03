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

/** Hugging Face model API root, answering revision metadata and file lists. */
export const HF_API_BASE = "https://huggingface.co/api/models";
