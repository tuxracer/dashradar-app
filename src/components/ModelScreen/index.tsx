import { useEffect, useRef, useState } from "react";
import { ChevronLeft, X } from "lucide-react";
import { isDeepEqual } from "remeda";
import { useDetection } from "@/context/DetectionContext";
import { useSettings } from "@/context/SettingsContext";
import {
  addStoredModel,
  DEFAULT_MODEL,
  isAddModelError,
  knownModels,
  MAX_SELECTED_MODELS,
  removeStoredModel,
  resolveModelFromUrl,
  resolveModels,
} from "@/lib/detectionModels";
import type { DetectionModel } from "@/lib/detectionModels";
import { trialLoadModel } from "@/lib/modelTrialLoad";
import {
  ADD_ERROR_COPY,
  ADD_FAILED_MESSAGE,
  COMMIT_FAILED_MESSAGE,
  GENERIC_CLASSES_MESSAGE,
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
 * Full-screen picker for the model the detector runs, opened from the developer
 * section of the settings panel.
 *
 * The selection lives in a draft until Save, so leaving the screen cannot
 * change what the detector runs. Save is the only way out that applies
 * anything: it confirms, writes the selection straight to storage, and reloads,
 * because a running worker holds a session built from the model it loaded and
 * swapping that under a live drive is not something this app does. That is also
 * why no row here says a restart is needed; the screen performs it.
 */
export const ModelScreen = ({
  onClose,
  models: modelsProp,
  reload = () => window.location.reload(),
  trialLoad = trialLoadModel,
}: ModelScreenProps) => {
  const { modelIds, commitModelIds } = useSettings();
  const { activeModel } = useDetection();
  const [models, setModels] = useState<readonly DetectionModel[]>(
    () => modelsProp ?? knownModels(),
  );
  // Seeded from the resolved selection rather than the raw stored ids, so a
  // stale id left by an older build shows as the model that would actually run
  // and Save is not offered for a difference nobody made.
  const [draft, setDraft] = useState<readonly string[]>(() =>
    resolveModels(modelIds, models).map((model) => model.id),
  );
  // Compared against what the session pinned at mount, not against what is
  // stored, because Save's whole job is applying the draft to the running
  // detector. The two can disagree: turning developer options on mid-session
  // reveals a stored selection the session never saw, and comparing against
  // storage would leave Save disabled while the picker showed a model the
  // detector is not running, with no way to make it true.
  const changed = !isDeepEqual([...draft], [activeModel.id]);

  const [add, setAdd] = useState<AddPhase>({ phase: "closed" });
  // Aborts a trial in flight when the screen unmounts, so BACK does not leave
  // a worker downloading tens of megabytes for a screen nobody is on. Created
  // at the very top of handleAdd, before the URL is even resolved, so an
  // unmount during the Hugging Face lookup is caught too: resolveModelFromUrl
  // has no signal of its own to cancel, but every continuation after an
  // await checks this controller before touching state or starting a trial.
  const abortRef = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => abortRef.current?.abort(), []);

  /** Re-read the list after a stored-model mutation. */
  const refreshModels = () => {
    setModels(modelsProp ?? knownModels());
  };

  const openAdd = () => setAdd({ phase: "editing", url: "" });

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
      setAdd({
        phase: "failed",
        url: candidateUrl,
        message: isAddModelError(error)
          ? [ADD_ERROR_COPY[error.code], error.detail].filter(Boolean).join(" ")
          : ADD_ERROR_COPY.REPO_LOOKUP_FAILED,
      });
      return;
    }
    if (controller.signal.aborted) {
      return;
    }
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
    if (!addStoredModel(entry)) {
      setAdd({
        phase: "failed",
        url: candidateUrl,
        message: ADD_FAILED_MESSAGE,
      });
      return;
    }
    refreshModels();
    setDraft([entry.id]);
    const labels = (result.loaded?.classes ?? []).map((c) => c.label);
    setAdd({
      phase: "added",
      summary:
        labels.length > 0
          ? `Detects: ${labels.join(", ")}`
          : GENERIC_CLASSES_MESSAGE,
    });
  };

  const handleRemove = (id: string) => {
    removeStoredModel(id);
    // A drafted selection of the removed row has nothing to apply anymore;
    // the default is the one row guaranteed to exist.
    setDraft((previous) =>
      previous.includes(id) ? [DEFAULT_MODEL.id] : previous,
    );
    refreshModels();
  };

  const toggleModel = (id: string) => {
    setDraft((previous) => {
      if (previous.includes(id)) {
        // Never leave nothing selected: there would be no model to load.
        return previous.length > 1
          ? previous.filter((entry) => entry !== id)
          : previous;
      }
      // Past the cap the oldest pick drops, so a single-select list behaves
      // like a radio group and a larger cap behaves like a queue.
      return [...previous, id].slice(-MAX_SELECTED_MODELS);
    });
  };

  const handleSave = () => {
    const names = resolveModels(draft, models)
      .map((model) => `${model.slug} ${model.revision}`)
      .join(", ");
    if (!window.confirm(`Run ${names}? The app will reload.`)) {
      return;
    }
    if (!commitModelIds(draft)) {
      window.alert(COMMIT_FAILED_MESSAGE);
      return;
    }
    reload();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-surface px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex items-center justify-between gap-6">
          <button
            type="button"
            data-testid="model-back"
            onClick={onClose}
            className="flex min-h-14 items-center gap-1 rounded-xl border border-white/25 pl-4 pr-6 text-base font-semibold tracking-[0.12em] text-white/90"
          >
            <ChevronLeft className="h-5 w-5 shrink-0" strokeWidth={2} />
            BACK
          </button>
          <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
            Detection model
          </span>
          <button
            type="button"
            data-testid="model-save"
            onClick={handleSave}
            disabled={!changed}
            className={`min-h-14 rounded-xl px-6 text-base font-semibold tracking-[0.12em] transition-colors ${
              changed
                ? "bg-hud-amber text-surface"
                : "bg-white/10 text-white/35"
            }`}
          >
            SAVE
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {models.map((model) => {
            const selected = draft.includes(model.id);
            return (
              <div key={model.id} className="flex items-stretch gap-2">
                <button
                  type="button"
                  data-testid={`model-option-${model.id}`}
                  onClick={() => toggleModel(model.id)}
                  className={`flex min-h-20 flex-1 flex-col gap-1 rounded-xl px-6 py-4 text-left transition-colors ${
                    selected ? "bg-hud-amber text-surface" : "bg-white/10"
                  }`}
                >
                  <span className="text-lg font-semibold tracking-[0.04em]">
                    {model.slug}
                  </span>
                  <span
                    className={`text-sm font-medium tracking-[0.06em] ${
                      selected ? "text-surface/70" : "text-white/45"
                    }`}
                  >
                    {model.revision}
                  </span>
                </button>
                {model.id !== DEFAULT_MODEL.id && (
                  <button
                    type="button"
                    data-testid={`model-remove-${model.id}`}
                    aria-label={`Remove ${model.slug}`}
                    onClick={() => handleRemove(model.id)}
                    className="flex min-w-14 items-center justify-center rounded-xl border border-white/25 text-white/60"
                  >
                    <X className="h-5 w-5" strokeWidth={2} />
                  </button>
                )}
              </div>
            );
          })}

          {(add.phase === "closed" || add.phase === "added") && (
            <button
              type="button"
              data-testid="model-add-open"
              onClick={openAdd}
              className="flex min-h-20 items-center justify-center rounded-xl bg-white/10 px-6 text-lg font-semibold tracking-[0.04em] text-white/90"
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
                className={`min-h-14 rounded-xl px-6 text-base font-semibold tracking-[0.12em] transition-colors ${
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

          {add.phase === "busy" && (
            <div className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl bg-white/10 px-6 py-4">
              <span
                data-testid="model-add-status"
                className="text-sm font-medium tracking-[0.06em] text-white/60"
              >
                {add.percent !== undefined
                  ? `DOWNLOADING ${add.percent}%`
                  : "CHECKING MODEL..."}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
