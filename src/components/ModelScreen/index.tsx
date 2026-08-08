import { useEffect, useRef, useState } from "react";
import { track } from "@vercel/analytics";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { ModelCard } from "@/components/ModelCard";
import { useSettings } from "@/context/SettingsContext";
import {
  addStoredModel,
  AddModelError,
  isAddModelError,
  knownModels,
  listOnnxFiles,
  MAX_SELECTED_MODELS,
  modelLabel,
  parseModelUrl,
  pinnedModel,
  removeStoredModel,
  reportableModelName,
  resolveModelFromUrl,
  resolveModels,
} from "@/lib/detectionModels";
import type { DetectionModel } from "@/lib/detectionModels";
import { trialLoadModel } from "@/lib/modelTrialLoad";
import { prefersReducedMotion } from "@/utils/prefersReducedMotion";
import {
  ADD_ERROR_COPY,
  ADD_FAILED_MESSAGE,
  CHOOSE_FILE_MESSAGE,
  COMMIT_FAILED_MESSAGE,
  GENERIC_CLASSES_MESSAGE,
  ROW_ENTER_STAGGER_MS,
  ROW_EXIT_MS,
} from "./consts";

export * from "./consts";

/**
 * Where a candidate's weights come from, the one thing worth separating about
 * an add: a Hugging Face repo the picker resolved and pinned, or a plain link
 * taken as pasted.
 */
const analyticsSource = (model: DetectionModel): string =>
  model.weightsUrl === undefined ? "huggingface" : "url";

/**
 * The add flow's state, one union so the row renders from a single value. The
 * pasted url lives here on the phases that show an input, and the failed phase
 * keeps it so a rejected paste can be corrected rather than retyped.
 */
type AddPhase =
  | { phase: "closed" }
  | { phase: "editing"; url: string }
  | { phase: "busy"; percent: number | undefined }
  | {
      phase: "choosing";
      url: string;
      owner: string;
      slug: string;
      sha: string;
      files: readonly string[];
    }
  | { phase: "failed"; url: string; message: string }
  | { phase: "added"; summary: string };

type ModelScreenProps = {
  /** Returns to the settings panel, discarding the draft. */
  onClose: () => void;
  /** Registry to list; overridable so tests can drive a fixed one. */
  models?: readonly DetectionModel[];
  /** Applies a committed selection; a real page reload, overridable for jsdom. */
  reload?: () => void;
  /** Runs the trial load; overridable because jsdom cannot run a worker. */
  trialLoad?: typeof trialLoadModel;
};

/**
 * Full-screen picker for the model the detector runs. A row opens that model's
 * card rather than selecting it, so choosing one happens after reading what it is.
 * Nothing is staged: taking a model from its card confirms, writes, and reloads
 * on the spot, and the reload is how a choice reaches the detector.
 */
export const ModelScreen = ({
  onClose,
  models: modelsProp,
  reload = () => window.location.reload(),
  trialLoad = trialLoadModel,
}: ModelScreenProps) => {
  const { modelIds, commitModelIds } = useSettings();
  const [models, setModels] = useState<readonly DetectionModel[]>(
    () => modelsProp ?? knownModels(),
  );
  // Resolved rather than raw, so a stale id marks the model that would actually
  // run instead of no row at all. Removing one therefore moves the mark to the
  // shipping entry, which is what the next load would do anyway.
  const selected = resolveModels(modelIds, models);
  const selectedIds = selected.map((model) => model.id);

  // An id rather than the entry, so a card left open over a model that was just
  // removed closes itself rather than describing something gone.
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const [add, setAdd] = useState<AddPhase>({ phase: "closed" });
  // The row currently collapsing out. Its model is already gone from storage;
  // this only keeps the element on screen for the length of the animation.
  const [leavingId, setLeavingId] = useState<string | undefined>(undefined);
  // Aborts a trial in flight on unmount, so BACK does not leave a worker
  // downloading for a screen nobody is on. Created before the URL is resolved, so
  // every continuation after an await checks it before touching state.
  const abortRef = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => abortRef.current?.abort(), []);
  // The row-exit collapse timer, cleared on unmount so a removal followed
  // straight by BACK does not fire a callback into an unmounted tree.
  const rowExitRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(rowExitRef.current), []);

  // How many people look at all, which every other number here is a fraction of.
  useEffect(() => {
    track("model_picker_open");
  }, []);

  // One screen at a time, the same rule the settings panel follows. On the
  // capture phase and consuming the event, because the panel's own window
  // handler was registered first and would otherwise close both at once.
  useEffect(() => {
    if (!openId) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.stopImmediatePropagation();
      setOpenId(undefined);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [openId]);

  /** Re-read the list after a stored-model mutation. */
  const refreshModels = () => {
    setModels(modelsProp ?? knownModels());
  };

  const openAdd = () => setAdd({ phase: "editing", url: "" });

  /** Give up on a paste, leaving it in the field so it can be corrected. */
  const failAdd = (candidateUrl: string, error: unknown) => {
    track("model_add_failed", {
      reason: isAddModelError(error) ? error.code : "REPO_LOOKUP_FAILED",
    });
    setAdd({
      phase: "failed",
      url: candidateUrl,
      message: isAddModelError(error)
        ? [ADD_ERROR_COPY[error.code], error.detail].filter(Boolean).join(" ")
        : ADD_ERROR_COPY.REPO_LOOKUP_FAILED,
    });
  };

  /**
   * Offer the repo's files when the resolve could not pick one. A second read of
   * the same revision metadata, cheap next to making someone find and paste the
   * exact file URL themselves.
   */
  const openChoice = async (
    candidateUrl: string,
    controller: AbortController,
  ) => {
    let listed: Awaited<ReturnType<typeof listOnnxFiles>>;
    try {
      listed = await listOnnxFiles(candidateUrl);
    } catch {
      if (!controller.signal.aborted) {
        failAdd(candidateUrl, new AddModelError("AMBIGUOUS_ONNX_FILE"));
      }
      return;
    }
    if (controller.signal.aborted) {
      return;
    }
    const parsed = parseModelUrl(candidateUrl);
    if (!parsed) {
      failAdd(candidateUrl, new AddModelError("INVALID_URL"));
      return;
    }
    setAdd({
      phase: "choosing",
      url: candidateUrl,
      owner: parsed.owner,
      slug: parsed.slug,
      sha: listed.sha,
      files: listed.files,
    });
  };

  const handleAdd = async (candidateUrl: string) => {
    // A trial still in flight loses its place in the ref, so abort it before its
    // late settle can write over this add.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setAdd({ phase: "busy", percent: undefined });
    let entry: DetectionModel;
    try {
      entry = await resolveModelFromUrl(candidateUrl);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      if (isAddModelError(error) && error.code === "AMBIGUOUS_ONNX_FILE") {
        await openChoice(candidateUrl, controller);
        return;
      }
      failAdd(candidateUrl, error);
      return;
    }
    if (controller.signal.aborted) {
      return;
    }
    await runTrial(entry, candidateUrl, controller);
  };

  /** Pick one of an ambiguous repo's files and carry on with the add. */
  const handleChoose = async (
    choice: Extract<AddPhase, { phase: "choosing" }>,
    file: string,
  ) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setAdd({ phase: "busy", percent: undefined });
    await runTrial(
      pinnedModel({
        owner: choice.owner,
        slug: choice.slug,
        revision: choice.sha,
        file,
      }),
      choice.url,
      controller,
    );
  };

  /** Download a candidate, and register it if it loads. */
  const runTrial = async (
    entry: DetectionModel,
    candidateUrl: string,
    controller: AbortController,
  ) => {
    const result = await trialLoad(entry, {
      signal: controller.signal,
      onProgress: (fraction) => {
        if (!controller.signal.aborted) {
          setAdd({ phase: "busy", percent: Math.round(fraction * 100) });
        }
      },
    });
    if (controller.signal.aborted) {
      return;
    }
    if (!result.ok) {
      // The reason is an onnxruntime message about someone else's file, so only
      // the fact of the rejection travels.
      track("model_add_failed", { reason: "TRIAL_FAILED" });
      setAdd({ phase: "failed", url: candidateUrl, message: result.reason });
      return;
    }
    // This load is the only time anything reads these exact bytes until the model
    // runs, so its classes are stored with the entry for the card to show.
    if (!addStoredModel({ ...entry, classes: result.loaded?.classes })) {
      track("model_add_failed", { reason: "STORAGE_FAILED" });
      setAdd({
        phase: "failed",
        url: candidateUrl,
        message: ADD_FAILED_MESSAGE,
      });
      return;
    }
    refreshModels();
    const labels = (result.loaded?.classes ?? []).map((c) => c.label);
    // Past the whole download-build-run sequence, so this counts checkpoints that
    // actually run here rather than pastes.
    track("model_add", {
      source: analyticsSource(entry),
      classes: labels.length,
    });
    setAdd({
      phase: "added",
      summary:
        labels.length > 0
          ? `Detects: ${labels.join(", ")}`
          : GENERIC_CLASSES_MESSAGE,
    });
  };

  const handleRemove = (model: DetectionModel) => {
    // Confirmed because getting the model back means pasting the URL again and
    // re-downloading the weights.
    if (!window.confirm(`Remove ${modelLabel(model)}?`)) {
      return;
    }
    track("model_remove", { source: analyticsSource(model) });
    removeStoredModel(model.id);
    // Back to the list, where the row this card was opened from collapses out.
    setOpenId(undefined);
    // Stays mounted long enough to collapse out, so the rows below travel into
    // the space instead of jumping. Storage is already updated.
    setLeavingId(model.id);
    rowExitRef.current = window.setTimeout(
      () => {
        setLeavingId(undefined);
        refreshModels();
      },
      prefersReducedMotion() ? 0 : ROW_EXIT_MS,
    );
  };

  /**
   * Apply a model straight from its card: confirm, write, reload. The reload is
   * how a choice reaches the detector, since a running worker holds a session
   * built from the model it loaded.
   */
  const chooseModel = (id: string) => {
    // Past the cap the oldest pick drops, so a single-select list behaves like
    // a radio group and a larger cap behaves like a queue.
    const ids = [...selectedIds, id].slice(-MAX_SELECTED_MODELS);
    const names = resolveModels(ids, models).map(modelLabel).join(", ");
    if (!window.confirm(`Use ${names}?`)) {
      return;
    }
    // Before the commit, because the reload on the next line can cut an in-flight
    // request: this is the widest window the event will get.
    track("model_switch", {
      from: selected.map(reportableModelName).join(", "),
      to: resolveModels(ids, models).map(reportableModelName).join(", "),
    });
    if (!commitModelIds(ids)) {
      window.alert(COMMIT_FAILED_MESSAGE);
      return;
    }
    reload();
  };

  // Rendered instead of the list rather than over it, the same way the panel
  // hands over to this screen: one screen on the glass at a time.
  const openModel = models.find((model) => model.id === openId);
  if (openModel) {
    return (
      <ModelCard
        model={openModel}
        selected={selectedIds.includes(openModel.id)}
        onUse={() => chooseModel(openModel.id)}
        onRemove={() => handleRemove(openModel)}
        onBack={() => setOpenId(undefined)}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-surface px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex animate-rise-in items-center gap-6 motion-reduce:animate-none">
          <button
            type="button"
            data-testid="model-back"
            onClick={onClose}
            className="flex min-h-14 items-center gap-1 rounded-xl border border-white/25 pl-4 pr-6 text-base font-semibold tracking-[0.12em] text-white/90 transition active:scale-[0.97] motion-reduce:transition-none"
          >
            <ChevronLeft className="h-5 w-5 shrink-0" strokeWidth={2} />
            BACK
          </button>
          <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
            Detection model
          </span>
          {/* Small, and off to the side. Pasting a URL is a rare, deliberate
              errand next to picking one of the models already here, and it
              read as the main thing on the screen while it was a full-width
              row under the list. */}
          <button
            type="button"
            data-testid="model-add-open"
            aria-label="Add a model"
            onClick={openAdd}
            className="ml-auto flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:text-white/90 active:scale-[0.94] motion-reduce:transition-none"
          >
            <Plus className="h-7 w-7" strokeWidth={2} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {/* Keyed on the phase so each step of the add flow remounts, which
              is what re-runs its entrance: the content is swapping in place,
              not arriving from off screen. */}
          <div
            key={add.phase}
            // No entrance delay: every phase that draws anything is the
            // result of a tap and has to answer it immediately, and the
            // "closed" phase draws nothing at all.
            className="flex animate-swap-in flex-col gap-3 motion-reduce:animate-none"
          >
            {add.phase === "added" && (
              <span
                data-testid="model-add-status"
                className="text-sm font-medium tracking-[0.06em] text-white/45"
              >
                {add.summary}
              </span>
            )}

            {(add.phase === "editing" || add.phase === "failed") && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleAdd(add.url);
                }}
                noValidate
                className="flex flex-col gap-2"
              >
                <input
                  type="url"
                  inputMode="url"
                  data-testid="model-add-url"
                  value={add.url}
                  onChange={(event) =>
                    setAdd({ phase: "editing", url: event.target.value })
                  }
                  placeholder="https://huggingface.co/owner/repo"
                  className="min-h-14 w-full rounded-xl bg-white/10 px-4 text-base font-medium tracking-[0.04em] text-white/90 placeholder:text-white/35"
                />
                <button
                  type="submit"
                  data-testid="model-add-submit"
                  disabled={add.url.trim().length === 0}
                  className={`min-h-14 rounded-xl px-6 text-base font-semibold tracking-[0.12em] transition duration-200 active:scale-[0.97] motion-reduce:transition-none ${
                    add.url.trim().length > 0
                      ? "bg-hud-amber text-surface"
                      : "bg-white/10 text-white/35"
                  }`}
                >
                  ADD
                </button>
                {add.phase === "failed" && (
                  <span
                    data-testid="model-add-status"
                    className="text-sm font-medium tracking-[0.06em] text-white/60"
                  >
                    {add.message}
                  </span>
                )}
              </form>
            )}

            {add.phase === "choosing" && (
              <div className="flex flex-col gap-3">
                <span
                  data-testid="model-add-status"
                  className="text-sm font-medium tracking-[0.06em] text-white/60"
                >
                  {CHOOSE_FILE_MESSAGE}
                </span>
                {add.files.map((file, index) => (
                  <button
                    key={file}
                    type="button"
                    data-testid={`model-file-${file}`}
                    onClick={() => void handleChoose(add, file)}
                    style={{
                      animationDelay: `${(index + 1) * ROW_ENTER_STAGGER_MS}ms`,
                    }}
                    className="min-h-20 animate-rise-in break-all rounded-xl bg-white/10 px-6 py-4 text-left text-lg font-semibold tracking-[0.04em] text-white/90 transition active:scale-[0.98] motion-reduce:animate-none motion-reduce:transition-none"
                  >
                    {file}
                  </button>
                ))}
                <button
                  type="button"
                  data-testid="model-file-cancel"
                  onClick={() => setAdd({ phase: "editing", url: add.url })}
                  style={{
                    animationDelay: `${(add.files.length + 1) * ROW_ENTER_STAGGER_MS}ms`,
                  }}
                  className="min-h-14 animate-rise-in rounded-xl border border-white/25 px-6 text-base font-semibold tracking-[0.12em] text-white/70 transition active:scale-[0.97] motion-reduce:animate-none motion-reduce:transition-none"
                >
                  CANCEL
                </button>
              </div>
            )}

            {add.phase === "busy" && (
              <div className="flex min-h-20 flex-col items-center justify-center gap-3 rounded-xl bg-white/10 px-6 py-4">
                <span
                  data-testid="model-add-status"
                  className="text-sm font-medium tracking-[0.06em] text-white/60"
                >
                  {add.percent !== undefined
                    ? `DOWNLOADING ${add.percent}%`
                    : "CHECKING MODEL..."}
                </span>
                {/* Only once there is a real fraction to show. An empty track
                  during the lookup would read as a download stuck at zero.
                  The width is driven by progress events, so nothing here
                  animates on its own. */}
                {add.percent !== undefined && (
                  <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/15">
                    <div
                      data-testid="model-add-progress"
                      style={{ width: `${add.percent}%` }}
                      className="h-full bg-hud-amber transition-[width] duration-200 ease-linear motion-reduce:transition-none"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
          {models.map((model, index) => {
            const selected = selectedIds.includes(model.id);
            const leaving = model.id === leavingId;
            return (
              <div
                key={model.id}
                // Every row carries its entrance, so the first render staggers
                // the whole list in and a row added later arrives on its own.
                // A leaving row drops the delay: it is racing the timer that
                // unmounts it, and a staggered start would be cut off.
                style={{
                  animationDelay: leaving
                    ? "0ms"
                    : `${(index + 1) * ROW_ENTER_STAGGER_MS}ms`,
                }}
                className={`flex items-stretch gap-2 motion-reduce:animate-none ${
                  leaving
                    ? "animate-row-out overflow-hidden"
                    : "animate-rise-in"
                }`}
              >
                <button
                  type="button"
                  data-testid={`model-option-${model.id}`}
                  onClick={() => setOpenId(model.id)}
                  // The amber arrives as a wipe rather than a repaint, so the
                  // eye is told which row took the selection. Two entries can
                  // read almost identically at a glance.
                  className={`relative flex min-h-20 flex-1 items-center justify-between gap-4 overflow-hidden rounded-xl bg-white/10 px-6 py-4 text-left transition duration-300 before:absolute before:inset-0 before:origin-left before:bg-hud-amber before:transition-transform before:duration-300 before:ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98] motion-reduce:transition-none motion-reduce:before:transition-none ${
                    selected
                      ? "text-surface before:scale-x-100"
                      : "text-white before:scale-x-0"
                  }`}
                >
                  <span className="flex flex-col gap-1">
                    <span className="relative text-lg font-semibold tracking-[0.04em]">
                      {model.slug}
                    </span>
                    <span
                      className={`relative text-sm font-medium tracking-[0.06em] transition-colors duration-300 motion-reduce:transition-none ${
                        selected ? "text-surface/70" : "text-white/45"
                      }`}
                    >
                      {model.revision ?? model.owner}
                    </span>
                  </span>
                  <ChevronRight
                    className="relative h-5 w-5 shrink-0"
                    strokeWidth={2}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
