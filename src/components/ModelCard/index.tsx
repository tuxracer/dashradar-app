import { ChevronLeft, ExternalLink } from "lucide-react";
import { useDetection } from "@/context/DetectionContext";
import { DEFAULT_MODEL, modelRepoUrl } from "@/lib/detectionModels";
import type { DetectionClass, DetectionModel } from "@/lib/detectionModels";
import {
  MORE_INFO_LABEL,
  ON_DEVICE_MESSAGE,
  SECTION_ENTER_STAGGER_MS,
  SHORT_REVISION_LENGTH,
  UNKNOWN_CLASSES_MESSAGE,
} from "./consts";

export * from "./consts";

/** Props for ModelCard. */
type ModelCardProps = {
  /** The registry entry this card describes. */
  model: DetectionModel;
  /** Whether the picker's draft already points at this entry. */
  selected: boolean;
  /** Draft this model as the selection; the picker owns applying it. */
  onUse: () => void;
  /** Unregister this model, confirm and all; only offered for added ones. */
  onRemove: () => void;
  /** Return to the picker list. */
  onBack: () => void;
};

/** One label-and-value line of the card's facts. */
const Fact = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-baseline justify-between gap-6 py-3">
    <span className="text-sm font-semibold tracking-[0.12em] text-white/45">
      {label}
    </span>
    <span className="text-right text-base font-semibold tracking-[0.04em] text-white/85">
      {value}
    </span>
  </div>
);

/** A tag is short enough to read; a commit sha is not, so it is abbreviated. */
const shortRevision = (revision: string): string =>
  revision.length > SHORT_REVISION_LENGTH * 2
    ? revision.slice(0, SHORT_REVISION_LENGTH)
    : revision;

/** The labels a set of classes carries, as one readable list. */
const classLabels = (classes: readonly DetectionClass[]): string =>
  classes.map((entry) => entry.label).join(", ");

/**
 * What one model is, for someone deciding whether to run it: what it looks for,
 * who published it, which version, and a way out to the page it came from.
 *
 * The classes are read from whichever session actually loaded the file, never
 * from anything typed in here, so the card cannot claim a model detects
 * something it does not: the running model's come from its own live session,
 * an added model's from the trial load that registered it, and a model neither
 * has seen says so rather than guessing.
 */
export const ModelCard = ({
  model,
  selected,
  onUse,
  onRemove,
  onBack,
}: ModelCardProps) => {
  const { activeModel, loadedClasses } = useDetection();
  const running = model.id === activeModel.id;
  const classes = (running ? loadedClasses : undefined) ?? model.classes;
  const removable = model.id !== DEFAULT_MODEL.id;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-surface px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex animate-rise-in items-center gap-6 motion-reduce:animate-none">
          <button
            type="button"
            data-testid="model-card-back"
            onClick={onBack}
            className="flex min-h-14 items-center gap-1 rounded-xl border border-white/25 pl-4 pr-6 text-base font-semibold tracking-[0.12em] text-white/90 transition active:scale-[0.97] motion-reduce:transition-none"
          >
            <ChevronLeft className="h-5 w-5 shrink-0" strokeWidth={2} />
            BACK
          </button>
          {running && (
            <span className="text-base font-semibold tracking-[0.12em] text-hud-amber">
              RUNNING NOW
            </span>
          )}
        </div>

        <div
          style={{ animationDelay: `${1 * SECTION_ENTER_STAGGER_MS}ms` }}
          className="flex animate-rise-in flex-col gap-1 motion-reduce:animate-none"
        >
          <span className="break-words text-3xl font-semibold tracking-[0.02em] text-white">
            {model.slug}
          </span>
          <span className="text-sm font-medium text-white/45">
            {ON_DEVICE_MESSAGE}
          </span>
        </div>

        <div
          style={{ animationDelay: `${2 * SECTION_ENTER_STAGGER_MS}ms` }}
          className="flex animate-rise-in flex-col divide-y divide-white/10 motion-reduce:animate-none"
        >
          <Fact
            label="LOOKS FOR"
            value={
              classes && classes.length > 0
                ? classLabels(classes)
                : UNKNOWN_CLASSES_MESSAGE
            }
          />
          <Fact label="FROM" value={model.owner} />
          <Fact label="VERSION" value={shortRevision(model.revision)} />
        </div>

        <div
          style={{ animationDelay: `${3 * SECTION_ENTER_STAGGER_MS}ms` }}
          className="flex animate-rise-in flex-col gap-3 motion-reduce:animate-none"
        >
          <button
            type="button"
            data-testid="model-card-use"
            onClick={onUse}
            disabled={selected}
            className={`min-h-16 rounded-xl px-6 text-lg font-semibold tracking-[0.12em] transition duration-200 active:scale-[0.98] motion-reduce:transition-none ${
              selected
                ? "bg-white/10 text-white/35"
                : "bg-hud-amber text-surface"
            }`}
          >
            {selected ? "IN USE" : "USE THIS MODEL"}
          </button>

          <a
            href={modelRepoUrl(model)}
            target="_blank"
            rel="noreferrer"
            data-testid="model-card-link"
            className="flex min-h-16 items-center justify-between gap-4 rounded-xl border border-white/25 px-6 transition active:scale-[0.98] motion-reduce:transition-none"
          >
            <span className="flex flex-col gap-0.5 text-left">
              <span className="text-base font-semibold tracking-[0.12em] text-white/90">
                {MORE_INFO_LABEL}
              </span>
              {/* The destination, not the model's name again: this is the one
                  control on the card that leaves the app, and where it goes is
                  the thing worth knowing before the tap. */}
              <span className="break-all text-sm font-medium text-white/45">
                {modelRepoUrl(model).replace("https://", "")}
              </span>
            </span>
            <ExternalLink className="h-5 w-5 shrink-0 text-white/60" />
          </a>

          {removable && (
            <button
              type="button"
              data-testid={`model-remove-${model.id}`}
              onClick={onRemove}
              className="min-h-14 rounded-xl border border-white/25 px-6 text-base font-semibold tracking-[0.12em] text-white/70 transition active:scale-[0.97] motion-reduce:transition-none"
            >
              REMOVE
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
