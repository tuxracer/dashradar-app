import { isString } from "remeda";
import type { OnnxMetadata } from "@/lib/onnxMetadata";
import { DETECTION_MODELS, MODEL_OWNER } from "./consts";
import type { DetectionClass, DetectionModel } from "./types";

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
 * How a class label reads on the HUD. Uppercased because that is the register
 * the rest of the display is in, with separators opened up so `fire_truck`
 * reads as FIRE TRUCK rather than FIRE_TRUCK.
 */
const displayLabelOf = (label: string): string =>
  label.replace(/[_-]+/g, " ").trim().toUpperCase();

/**
 * The classes a loaded checkpoint names, read from the `names` map its export
 * stamps into the file: a JSON object of logit index to label, the only
 * machine-readable record of what a slot means. Indices outside the head the
 * session reported are dropped, as is slot 0, the background slot every RF-DETR
 * head reserves and no decode reads.
 *
 * A file that names nothing (any build exported before stamping, or a
 * checkpoint from somewhere that does not stamp) still has to detect. Every
 * slot in its head gets a generic label instead, so the meter, the alert ring
 * and the boxes all work and only the words on the contact card are poorer.
 * Failing the load instead would turn a cosmetic gap into a dead detector.
 */
export const classesFromMetadata = (
  metadata: OnnxMetadata | undefined,
  headWidth: number,
): readonly DetectionClass[] => {
  const named = parseNames(metadata).flatMap<DetectionClass>(
    ([index, label]) => {
      if (!Number.isInteger(index) || index < 1 || index >= headWidth) {
        return [];
      }
      return [{ index, label, displayLabel: displayLabelOf(label) }];
    },
  );
  if (named.length > 0) {
    return named;
  }
  return Array.from({ length: headWidth - 1 }, (_, slot) => ({
    index: slot + 1,
    label: `class-${slot + 1}`,
    displayLabel: `CLASS ${slot + 1}`,
  }));
};

/**
 * The `names` entry as index/label pairs, or nothing at all. It is a JSON
 * string inside a string map, so every part of it is untrusted: not present,
 * not JSON, not an object, or an entry whose key is not a number or whose value
 * is not a string all mean the file named nothing usable.
 */
const parseNames = (
  metadata: OnnxMetadata | undefined,
): readonly (readonly [number, string])[] => {
  const raw = metadata?.props.names;
  if (raw === undefined) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return [];
  }
  return Object.entries(parsed).flatMap(([key, value]) =>
    isString(value) && value.length > 0 ? [[Number(key), value] as const] : [],
  );
};

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
