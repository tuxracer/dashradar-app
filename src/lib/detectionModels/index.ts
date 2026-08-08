import { isPlainObject, isString } from "remeda";
import type { OnnxMetadata } from "@/lib/onnxMetadata";
import { BUILT_IN_MODELS, HF_API_BASE, STORED_MODELS_KEY } from "./consts";
import { AddModelError, isDetectionModel } from "./types";
import type { DetectionClass, DetectionModel, ParsedModelUrl } from "./types";

export * from "./consts";
export * from "./types";

/**
 * Page a model is published on, or undefined for a plain-URL model: an address
 * that serves weights is not a page about them, and sending someone there would
 * start a download rather than explain anything.
 */
export const modelRepoUrl = (
  model: Omit<DetectionModel, "id">,
): string | undefined =>
  model.weightsUrl === undefined
    ? `https://huggingface.co/${model.owner}/${model.slug}`
    : undefined;

/**
 * Where a model's weights are fetched from. The revision pin is what makes a
 * release reach anyone, since the cache is CacheFirst keyed on URL. Takes the
 * id-less shape because an added model's id is this URL.
 */
export const modelWeightsUrl = (model: Omit<DetectionModel, "id">): string =>
  model.weightsUrl ??
  `https://huggingface.co/${model.owner}/${model.slug}/resolve/${model.revision}/${model.file}`;

/**
 * How a model is named where both its name and its version matter, like the
 * confirms that run or remove one. A plain-URL model has no version to add.
 */
export const modelLabel = (model: DetectionModel): string =>
  model.revision === undefined ? model.slug : `${model.slug} ${model.revision}`;

/**
 * The classes a checkpoint names, from the `names` map its export stamps in.
 * Indices outside the reported head are dropped, as is the background slot 0. A
 * file that names nothing still has to detect, so every slot gets a generic
 * label rather than turning a cosmetic gap into a dead detector.
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
 * The `names` entry as index/label pairs. It comes in two dialects, Python's
 * `str()` of a dict (`{0: 'person'}`) and `json.dumps` (`{"1": "police"}`), and a
 * reader that takes one silently reads half the models it meets, so this parses
 * the shape instead. Anything but a flat integer-to-label map means the file
 * named nothing usable.
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
 * The added models, from localStorage. An invalid entry is dropped rather than
 * thrown on, so a corrupt blob costs the added models and never the app. Safe
 * where localStorage does not exist, such as a worker.
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
 * Whether an entry is one the build ships. Only an added model can be removed; a
 * built-in lives in the code and would come straight back on the next load.
 */
export const isBuiltInModel = (model: DetectionModel): boolean =>
  BUILT_IN_MODELS.some((entry) => entry.id === model.id);

/**
 * How a model may be named in anything leaving the device: a built-in by its
 * slug, anything added generically, since an added model's identity is a pasted
 * URL. One function, because a reporting site that drifts leaks an address.
 */
export const reportableModelName = (model: DetectionModel): string =>
  isBuiltInModel(model) ? model.slug : "custom";

/**
 * Every model the app knows. The built-ins come from the code so the app runs
 * with empty storage and a revision bump reaches every device; a stored entry
 * shadowing a built-in id is dropped, since the build's copy is the current one.
 */
export const knownModels = (): readonly DetectionModel[] => [
  ...BUILT_IN_MODELS,
  ...loadStoredModels().filter((entry) => !isBuiltInModel(entry)),
];

/**
 * The entries a stored selection names, dropping ids this build does not know.
 * Never empty: a stale id degrades to the shipping checkpoint rather than asking
 * the worker for weights that do not exist.
 */
export const resolveModels = (
  ids: readonly string[],
  models: readonly DetectionModel[] = knownModels(),
): readonly DetectionModel[] => {
  const selected = models.filter((model) => ids.includes(model.id));
  return selected.length > 0 ? selected : [models[0]];
};

/**
 * Parse a pasted Hugging Face URL, or undefined for anything that is not a bare
 * repo page or a blob/resolve URL pointing at an .onnx file. Rejection here is
 * local and free; nothing hits the network until resolveModelFromUrl.
 */
export const parseModelUrl = (input: string): ParsedModelUrl | undefined => {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return undefined;
  }
  if (url.hostname !== "huggingface.co") {
    return undefined;
  }
  let segments: string[];
  try {
    segments = url.pathname
      .split("/")
      .filter((segment) => segment.length > 0)
      .map(decodeURIComponent);
  } catch {
    return undefined;
  }
  if (segments.length === 2) {
    const [owner, slug] = segments;
    return { owner, slug };
  }
  const [owner, slug, kind, revision, ...path] = segments;
  if (
    (kind !== "blob" && kind !== "resolve") ||
    revision === undefined ||
    path.length === 0
  ) {
    return undefined;
  }
  const file = path.join("/");
  if (!file.endsWith(".onnx")) {
    return undefined;
  }
  return { owner, slug, revision, file };
};

/**
 * Turn a plain https link to an .onnx file into an entry. Everything a card shows
 * is read off the address, since a bare file has nothing else to say for itself.
 * The URL is the id, so re-adding the same link updates one entry.
 */
export const directUrlModel = (input: string): DetectionModel | undefined => {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") {
    return undefined;
  }
  let file: string;
  try {
    file = decodeURIComponent(url.pathname.split("/").pop() ?? "");
  } catch {
    return undefined;
  }
  if (!file.endsWith(".onnx")) {
    return undefined;
  }
  return {
    id: trimmed,
    owner: url.hostname,
    slug: file.slice(0, -".onnx".length),
    file,
    weightsUrl: trimmed,
  };
};

/** The two facts the HF revision endpoint answers with that matter here. */
type HfRevisionInfo = { sha: string; onnxFiles: readonly string[] };

/** Ask the HF API about one revision of a repo: its commit sha and onnx files. */
const fetchRevisionInfo = async (
  parsed: ParsedModelUrl,
  fetcher: typeof fetch,
): Promise<HfRevisionInfo> => {
  const revision = encodeURIComponent(parsed.revision ?? "main");
  const response = await fetcher(
    `${HF_API_BASE}/${parsed.owner}/${parsed.slug}/revision/${revision}`,
  );
  if (!response.ok) {
    throw new AddModelError("REPO_LOOKUP_FAILED");
  }
  const body: unknown = await response.json();
  if (
    !isPlainObject(body) ||
    !isString(body.sha) ||
    !Array.isArray(body.siblings)
  ) {
    throw new AddModelError("REPO_LOOKUP_FAILED");
  }
  const onnxFiles = body.siblings.flatMap((sibling: unknown) =>
    isPlainObject(sibling) &&
    isString(sibling.rfilename) &&
    sibling.rfilename.endsWith(".onnx")
      ? [sibling.rfilename]
      : [],
  );
  return { sha: body.sha, onnxFiles };
};

/** Whether a revision is already a full, lowercase commit sha. */
const isCommitSha = (revision: string): boolean =>
  /^[0-9a-f]{40}$/.test(revision);

/**
 * Turn a pasted URL into a registrable entry: a Hugging Face URL is pinned and
 * resolved to one .onnx file, any other https link to an .onnx file is taken as
 * it is. Pinning goes through the API because a tag or branch can move without
 * the URL changing, and the cache is CacheFirst keyed on URL; only a commit sha
 * is trusted as immutable and skips the request. `fetcher` is a test seam.
 */
export const resolveModelFromUrl = async (
  input: string,
  fetcher: typeof fetch = fetch,
): Promise<DetectionModel> => {
  const parsed = parseModelUrl(input);
  if (!parsed) {
    // Anywhere else the link must name the file itself: no API to ask what a
    // strange host holds, and no revision of it to pin.
    const direct = directUrlModel(input);
    if (!direct) {
      throw new AddModelError("INVALID_URL");
    }
    return direct;
  }
  if (
    parsed.file !== undefined &&
    parsed.revision !== undefined &&
    isCommitSha(parsed.revision)
  ) {
    return pinnedModel({
      owner: parsed.owner,
      slug: parsed.slug,
      revision: parsed.revision,
      file: parsed.file,
    });
  }
  const info = await fetchRevisionInfo(parsed, fetcher);
  if (parsed.file !== undefined) {
    return pinnedModel({
      owner: parsed.owner,
      slug: parsed.slug,
      revision: info.sha,
      file: parsed.file,
    });
  }
  if (info.onnxFiles.length === 0) {
    throw new AddModelError("NO_ONNX_FILE");
  }
  if (info.onnxFiles.length > 1) {
    throw new AddModelError("AMBIGUOUS_ONNX_FILE", info.onnxFiles.join(", "));
  }
  return pinnedModel({
    owner: parsed.owner,
    slug: parsed.slug,
    revision: info.sha,
    file: info.onnxFiles[0],
  });
};

/**
 * Assemble an entry whose id is its own pinned weights URL. The revision must
 * already be a commit sha; unchecked, because both callers get theirs from the
 * API rather than from pasted text.
 */
export const pinnedModel = (
  parts: Omit<DetectionModel, "id">,
): DetectionModel => ({ ...parts, id: modelWeightsUrl(parts) });

/**
 * The .onnx files a repo revision holds and the sha they live at, so a caller
 * that hit AMBIGUOUS_ONNX_FILE can offer the choice. Sorted, so the same repo
 * always lists the same way. Throws AddModelError.
 */
export const listOnnxFiles = async (
  input: string,
  fetcher: typeof fetch = fetch,
): Promise<{ sha: string; files: readonly string[] }> => {
  const parsed = parseModelUrl(input);
  if (!parsed) {
    throw new AddModelError("INVALID_URL");
  }
  const info = await fetchRevisionInfo(parsed, fetcher);
  return { sha: info.sha, files: [...info.onnxFiles].sort() };
};
