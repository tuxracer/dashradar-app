import type { OnnxMetadata } from "@/lib/onnxMetadata";
import { DEFAULT_MODEL, STORED_MODELS_KEY } from "./consts";
import { isDetectionModel } from "./types";
import type { DetectionClass, DetectionModel } from "./types";

export * from "./consts";
export * from "./types";

/** Hugging Face page a model's weights are published on. */
export const modelRepoUrl = (model: Omit<DetectionModel, "id">): string =>
  `https://huggingface.co/${model.owner}/${model.slug}`;

/**
 * Revision-pinned URL of a model's ONNX weights. The pin is what makes a model
 * release reach anyone: the service worker caches weights CacheFirst keyed on
 * URL, so a changed revision is a changed URL and a cache miss, while an
 * unchanged one is served from cache forever. Takes the id-less shape because
 * an added model's id IS this URL, so the id cannot exist before the URL does.
 */
export const modelWeightsUrl = (model: Omit<DetectionModel, "id">): string =>
  `${modelRepoUrl(model)}/resolve/${model.revision}/${model.file}`;

/**
 * The classes a loaded checkpoint names, read from the `names` map its export
 * stamps into the file: logit index to label, the only machine-readable record
 * of what a slot means. Indices outside the head the
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
      return [{ index, label }];
    },
  );
  if (named.length > 0) {
    return named;
  }
  return Array.from({ length: headWidth - 1 }, (_, slot) => ({
    index: slot + 1,
    label: `class ${slot + 1}`,
  }));
};

/**
 * The `names` entry as index/label pairs, or nothing at all.
 *
 * `names` is the ecosystem's convention for the one thing an ONNX file has no
 * standard field for, and it comes in two dialects. Ultralytics stringifies the
 * dict with Python's own `str()`, giving `{0: 'person', 1: 'bicycle'}`: bare
 * integer keys and single quotes, which is a Python literal and not JSON. A
 * `json.dumps` export gives `{"1": "police"}` instead. Both name the same thing
 * and a reader that takes only one of them silently reads half the models it
 * meets, so this parses the shape rather than either dialect.
 *
 * The shape is narrow on purpose: a flat map of integer to label is all a class
 * table can be, so anything else in there means the value is not a names map and
 * the file named nothing usable.
 */
const parseNames = (
  metadata: OnnxMetadata | undefined,
): readonly (readonly [number, string])[] => {
  const raw = metadata?.props.names?.trim();
  if (raw === undefined || !raw.startsWith("{") || !raw.endsWith("}")) {
    return [];
  }
  const entries: (readonly [number, string])[] = [];
  let at = 1;
  const end = raw.length - 1;
  const skipSpace = () => {
    while (at < end && /\s/.test(raw[at])) {
      at += 1;
    }
  };
  /** Read a quoted string in either quote style, or undefined if there is none. */
  const readQuoted = (): string | undefined => {
    const quote = raw[at];
    if (quote !== "'" && quote !== '"') {
      return undefined;
    }
    at += 1;
    let value = "";
    while (at < end) {
      const char = raw[at];
      if (char === "\\") {
        value += raw[at + 1] ?? "";
        at += 2;
        continue;
      }
      at += 1;
      if (char === quote) {
        return value;
      }
      value += char;
    }
    return undefined;
  };
  for (;;) {
    skipSpace();
    if (at >= end) {
      return entries;
    }
    // The key: bare digits in the Python dialect, quoted in the JSON one.
    const digits = /^\d+/.exec(raw.slice(at));
    let index: number;
    if (digits) {
      index = Number(digits[0]);
      at += digits[0].length;
    } else {
      const quoted = readQuoted();
      if (quoted === undefined || !/^\d+$/.test(quoted)) {
        return [];
      }
      index = Number(quoted);
    }
    skipSpace();
    if (raw[at] !== ":") {
      return [];
    }
    at += 1;
    skipSpace();
    const label = readQuoted();
    if (label === undefined) {
      return [];
    }
    if (label.length > 0) {
      entries.push([index, label] as const);
    }
    skipSpace();
    if (at >= end) {
      return entries;
    }
    if (raw[at] !== ",") {
      return [];
    }
    at += 1;
  }
};

/**
 * The models added from Hugging Face URLs, from localStorage. Anything that is
 * not a valid entry is dropped rather than thrown on: a corrupt blob costs the
 * added models, never the app. Safe to call where localStorage does not exist
 * (a worker); it reports no stored models there.
 */
export const loadStoredModels = (): readonly DetectionModel[] => {
  try {
    const raw = localStorage.getItem(STORED_MODELS_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isDetectionModel) : [];
  } catch {
    return [];
  }
};

/** Persist the stored-model list, reporting whether the write landed. */
const writeStoredModels = (models: readonly DetectionModel[]): boolean => {
  try {
    localStorage.setItem(STORED_MODELS_KEY, JSON.stringify(models));
    return true;
  } catch {
    return false;
  }
};

/**
 * Register a model, replacing any existing entry with the same id, and report
 * whether the write landed. The caller surfaces a failed write, since it is
 * about to offer the model as selectable.
 */
export const addStoredModel = (model: DetectionModel): boolean => {
  const rest = loadStoredModels().filter((entry) => entry.id !== model.id);
  return writeStoredModels([...rest, model]);
};

/** Unregister a stored model by id. The weights cache entry is left alone. */
export const removeStoredModel = (id: string): boolean =>
  writeStoredModels(loadStoredModels().filter((entry) => entry.id !== id));

/**
 * Every model the app knows: the build's default plus the stored additions.
 * There is no built-in versus custom distinction beyond where an entry lives;
 * the default comes from the build so the app runs with empty storage and so
 * a model release (a revision bump under the same id) reaches every device.
 */
export const knownModels = (): readonly DetectionModel[] => [
  DEFAULT_MODEL,
  ...loadStoredModels().filter((entry) => entry.id !== DEFAULT_MODEL.id),
];

/**
 * The registry entries a stored selection names, in registry order, dropping
 * ids this build does not know. Never empty: a selection that resolves to
 * nothing falls back to the first registered model, so a stale id left by an
 * older build degrades to the shipping checkpoint instead of asking the worker
 * for weights that do not exist.
 *
 * The registry parameter defaults to knownModels() (the default plus stored
 * additions), evaluated fresh per call so a change to storage between calls is
 * seen. Tests and the picker can still pass an explicit list to drive a
 * multi-model scenario without touching storage.
 */
export const resolveModels = (
  ids: readonly string[],
  models: readonly DetectionModel[] = knownModels(),
): readonly DetectionModel[] => {
  const selected = models.filter((model) => ids.includes(model.id));
  return selected.length > 0 ? selected : [models[0]];
};
