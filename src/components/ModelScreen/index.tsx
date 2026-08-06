import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
 * The add-flow's state, one discriminated union so the row renders from a
 * single value. The pasted url lives here too (on the phases that can show
 * an input), so it is the only source of truth for what the field holds; the
 * "failed" phase keeps it so a rejected paste can be corrected instead of
 * retyped.
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

/** Props for ModelScreen. */
type ModelScreenProps = {
  /** Returns to the settings panel, discarding the draft. */
  onClose: () => void;
  /**
   * Registry to list. Defaults to the known models (the build's default plus
   * stored additions); overridable so tests can drive a fixed list.
   */
  models?: readonly DetectionModel[];
  /**
   * Applies a committed selection. Defaults to a real page reload and is
   * overridable because jsdom cannot navigate, so a test asserting the reload
   * would otherwise have to stub an unforgeable global.
   */
  reload?: () => void;
  /**
   * Runs the candidate's trial load. Defaults to the real one, which spawns a
   * detection worker; overridable because jsdom cannot run a worker.
   */
  trialLoad?: typeof trialLoadModel;
};

/**
 * Full-screen picker for the model the detector runs, opened from the Detection
 * model row of the settings panel.
 *
 * A row opens that model's card rather than selecting it, so choosing one is
 * something you do after reading what it is; the card is also where a model is
 * removed. The list keeps the amber mark on the selected entry, since it is
 * what says which of several near-identical names is running.
 *
 * Nothing here is staged. Taking a model from its card confirms, writes the
 * selection, and reloads on the spot, and adding one from a URL registers it as
 * soon as the trial load proves it runs. There is no save step, because there
 * was never a second decision for it to carry: every action on this screen is
 * already an answer to a question the screen just asked. The reload is how a
 * choice reaches the detector, which is also why no row says a restart is
 * needed; the screen performs it.
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
  // Resolved rather than read raw, so a stale id left by an older build marks
  // the model that would actually run instead of no row at all. Removing a
  // model therefore moves the mark to the shipping entry on its own, which is
  // exactly what the next load would do with the id left behind.
  const selectedIds = resolveModels(modelIds, models).map((model) => model.id);

  // Which model's card is open, if any. An id rather than the entry, so a card
  // left open over a model that has just been removed closes itself instead of
  // describing something the registry no longer holds.
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const [add, setAdd] = useState<AddPhase>({ phase: "closed" });
  // The row currently collapsing out. Its model is already gone from storage;
  // this only keeps the element on screen for the length of the animation.
  const [leavingId, setLeavingId] = useState<string | undefined>(undefined);
  // Aborts a trial in flight when the screen unmounts, so BACK does not leave
  // a worker downloading tens of megabytes for a screen nobody is on. Created
  // at the very top of handleAdd, before the URL is even resolved, so an
  // unmount during the Hugging Face lookup is caught too: resolveModelFromUrl
  // has no signal of its own to cancel, but every continuation after an
  // await checks this controller before touching state or starting a trial.
  const abortRef = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Escape closes the open card and stops there, the same one-screen-at-a-time
  // rule the settings panel follows backing out of this screen. The listener is
  // on the capture phase and consumes the event, because the panel's own
  // handler is on window too and was registered first: left to run, it would
  // take the picker down with the card on a single press.
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
    setAdd({
      phase: "failed",
      url: candidateUrl,
      message: isAddModelError(error)
        ? [ADD_ERROR_COPY[error.code], error.detail].filter(Boolean).join(" ")
        : ADD_ERROR_COPY.REPO_LOOKUP_FAILED,
    });
  };

  /**
   * Offer the repo's files when the resolve could not pick one. The extra
   * lookup is a second read of the same revision metadata, which is cheap
   * next to making someone find and paste the exact file URL themselves.
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
      setAdd({ phase: "failed", url: candidateUrl, message: result.reason });
      return;
    }
    // The trial's own classes are stored with the entry, since this load is the
    // only time anything reads them out of these exact bytes until the model is
    // run; the card shows them from here.
    if (!addStoredModel({ ...entry, classes: result.loaded?.classes })) {
      setAdd({
        phase: "failed",
        url: candidateUrl,
        message: ADD_FAILED_MESSAGE,
      });
      return;
    }
    refreshModels();
    const labels = (result.loaded?.classes ?? []).map((c) => c.label);
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
    removeStoredModel(model.id);
    // Back to the list, where the row this card was opened from collapses out.
    setOpenId(undefined);
    // The row stays mounted long enough to collapse out, so the rows below it
    // travel into the space instead of jumping. Storage is already updated, so
    // a screen unmounted mid-collapse loses nothing but the animation.
    setLeavingId(model.id);
    window.setTimeout(
      () => {
        setLeavingId(undefined);
        refreshModels();
      },
      prefersReducedMotion() ? 0 : ROW_EXIT_MS,
    );
  };

  /**
   * Apply a model straight from its card: confirm, write the selection, reload.
   * There is no draft to keep and no save step, because there is nothing a
   * second screen could add to a decision already made by tapping the model and
   * answering the confirm. The reload is how a choice reaches the detector at
   * all: a running worker holds a session built from the model it loaded, and
   * swapping that under a live drive is not something this app does.
   */
  const chooseModel = (id: string) => {
    // Past the cap the oldest pick drops, so a single-select list behaves like
    // a radio group and a larger cap behaves like a queue.
    const ids = [...selectedIds, id].slice(-MAX_SELECTED_MODELS);
    const names = resolveModels(ids, models).map(modelLabel).join(", ");
    if (!window.confirm(`Use ${names}?`)) {
      return;
    }
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
        </div>

        <div className="flex flex-col gap-3">
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

          {/* Keyed on the phase so each step of the add flow remounts, which
              is what re-runs its entrance: the content is swapping in place,
              not arriving from off screen. */}
          <div
            key={add.phase}
            // "closed" is the only phase the screen can mount into, so it is
            // the only one that waits its turn behind the rows. Every other
            // phase is the result of a tap and has to answer it immediately.
            style={{
              animationDelay:
                add.phase === "closed"
                  ? `${(models.length + 1) * ROW_ENTER_STAGGER_MS}ms`
                  : "0ms",
            }}
            className="flex animate-swap-in flex-col gap-3 motion-reduce:animate-none"
          >
            {(add.phase === "closed" || add.phase === "added") && (
              <button
                type="button"
                data-testid="model-add-open"
                onClick={openAdd}
                className="flex min-h-20 items-center justify-center rounded-xl bg-white/10 px-6 text-lg font-semibold tracking-[0.04em] text-white/90 transition active:scale-[0.98] motion-reduce:transition-none"
              >
                ADD MODEL
              </button>
            )}
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
        </div>
      </div>
    </div>
  );
};
