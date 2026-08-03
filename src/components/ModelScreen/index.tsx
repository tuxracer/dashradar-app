import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { isDeepEqual } from "remeda";
import { useDetection } from "@/context/DetectionContext";
import { useSettings } from "@/context/SettingsContext";
import {
  DETECTION_MODELS,
  MAX_SELECTED_MODELS,
  resolveModels,
} from "@/lib/detectionModels";
import type { DetectionModel } from "@/lib/detectionModels";
import { COMMIT_FAILED_MESSAGE } from "./consts";

export * from "./consts";

/** Props for ModelScreen. */
type ModelScreenProps = {
  /** Returns to the settings panel, discarding the draft. */
  onClose: () => void;
  /**
   * Registry to list. Defaults to what ships and is overridable so tests can
   * drive a multi-model list without one being published.
   */
  models?: readonly DetectionModel[];
  /**
   * Applies a committed selection. Defaults to a real page reload and is
   * overridable because jsdom cannot navigate, so a test asserting the reload
   * would otherwise have to stub an unforgeable global.
   */
  reload?: () => void;
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
  models = DETECTION_MODELS,
  reload = () => window.location.reload(),
}: ModelScreenProps) => {
  const { modelIds, commitModelIds } = useSettings();
  const { activeModel } = useDetection();
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
              <button
                key={model.id}
                type="button"
                data-testid={`model-option-${model.id}`}
                onClick={() => toggleModel(model.id)}
                className={`flex min-h-20 flex-col gap-1 rounded-xl px-6 py-4 text-left transition-colors ${
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
                  {model.revision} ·{" "}
                  {model.classes.map((entry) => entry.displayLabel).join(", ")}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
