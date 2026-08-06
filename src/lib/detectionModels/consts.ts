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
};

/**
 * A general-purpose detector offered beside the shipping one: Roboflow's COCO
 * checkpoint on RF-DETR Small, which names all 80 COCO categories. It is here
 * to be picked without pasting a URL, and nothing fetches it until someone
 * does. Running it turns the app into a detector of everyday objects rather
 * than of patrol vehicles: the meter takes the highest score of anything the
 * model names, so a car ahead drives the dial exactly as a police vehicle
 * would, and CONFIDENCE_THRESHOLD is the shipping checkpoint's operating point
 * rather than this one's.
 */
const COCO_MODEL: DetectionModel = {
  id: "coco-small",
  owner: "tuxracer",
  slug: "coco-rfdetr-small",
  revision: "v1.0",
  file: "onnx/model_fp16.onnx",
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
 * How many models may be selected at once. One today: the worker loads a single
 * session and the load message names a single model. Raising this is the one
 * edit the picker needs to become multi-select, but it is not sufficient on its
 * own, since the worker protocol would have to carry more than one id.
 */
export const MAX_SELECTED_MODELS = 1;

/** Hugging Face model API root, answering revision metadata and file lists. */
export const HF_API_BASE = "https://huggingface.co/api/models";
