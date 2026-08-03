import { DETECTION_MODELS, MODEL_OWNER } from "./consts";
import type { DetectionModel } from "./types";

export * from "./consts";
export * from "./types";

/** Hugging Face page a model's weights are published on. */
export const modelRepoUrl = (model: DetectionModel): string =>
  `https://huggingface.co/${MODEL_OWNER}/${model.slug}`;

/**
 * Revision-pinned URL of a model's ONNX weights. The pin is what makes a model
 * release reach anyone: the service worker caches weights CacheFirst keyed on
 * URL, so a changed revision is a changed URL and a cache miss, while an
 * unchanged one is served from cache forever.
 */
export const modelWeightsUrl = (model: DetectionModel): string =>
  `${modelRepoUrl(model)}/resolve/${model.revision}/onnx/${model.file}`;

/**
 * The registry entries a stored selection names, in registry order, dropping
 * ids this build does not know. Never empty: a selection that resolves to
 * nothing falls back to the first registered model, so a stale id left by an
 * older build degrades to the shipping checkpoint instead of asking the worker
 * for weights that do not exist.
 *
 * The registry parameter defaults to what ships and exists so tests and the
 * picker can drive a multi-model list without one being published.
 */
export const resolveModels = (
  ids: readonly string[],
  models: readonly DetectionModel[] = DETECTION_MODELS,
): readonly DetectionModel[] => {
  const selected = models.filter((model) => ids.includes(model.id));
  return selected.length > 0 ? selected : [models[0]];
};
