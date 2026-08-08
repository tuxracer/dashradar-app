import type { DetectionModel } from "./types";

/**
 * The model a build runs unless a developer picked otherwise, and the fallback
 * for a stored selection this build no longer recognizes. A build-time
 * constant on purpose: the app must run with empty storage, and the error
 * screen's revert action needs a target that always exists.
 */
export const DEFAULT_MODEL: DetectionModel = {
  id: "las-vegas-metro-nano",
  owner: "tuxracer",
  slug: "las-vegas-metro-rfdetr-nano",
  revision: "v1.0",
  file: "onnx/model_fp16.onnx",
  summary: "Finds marked Las Vegas police vehicles on the road.",
};

/**
 * A general-purpose COCO detector, here to be picked without pasting a URL;
 * nothing fetches it until someone does. Running it turns the app into a detector
 * of everyday objects, since the meter takes the highest score of anything the
 * model names and the threshold is the shipping checkpoint's operating point.
 */
const COCO_MODEL: DetectionModel = {
  id: "coco-small",
  owner: "tuxracer",
  slug: "coco-rfdetr-small",
  revision: "v1.0",
  file: "onnx/model_fp16.onnx",
  summary: "Finds 80 everyday things, from people and cars to traffic lights.",
};

/**
 * Every model a build offers without anyone pasting a URL, the default first.
 * Being listed costs nothing: an entry names bytes to fetch, and only the
 * selected model is ever loaded.
 */
export const BUILT_IN_MODELS: readonly DetectionModel[] = [
  DEFAULT_MODEL,
  COCO_MODEL,
];

/**
 * localStorage key the added models live under, as an array of DetectionModel
 * entries. Unprefixed, matching the app's other keys.
 */
export const STORED_MODELS_KEY = "models";

/**
 * How many models may be selected at once. One today, since the worker loads a
 * single session; raising it also needs the protocol to carry more than one id.
 */
export const MAX_SELECTED_MODELS = 1;

/** Hugging Face model API root, answering revision metadata and file lists. */
export const HF_API_BASE = "https://huggingface.co/api/models";
