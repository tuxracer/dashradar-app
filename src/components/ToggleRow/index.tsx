/** The pill switch. `on` drives the track and the knob. */
const Toggle = ({ on }: { on: boolean }) => (
  <span
    className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors ${
      on ? "bg-hud-amber" : "bg-white/25"
    }`}
  >
    <span
      className={`inline-block h-6 w-6 rounded-full bg-surface transition-transform ${
        on ? "translate-x-[1.75rem]" : "translate-x-[0.25rem]"
      }`}
    />
  </span>
);

/** Props for ToggleRow. */
type ToggleRowProps = {
  /** The setting's name, as it reads on the glass. */
  label: string;
  /** One short sentence saying what changes; see the settings-copy rules. */
  description: string;
  /** Current state of the setting. */
  on: boolean;
  /** Flips the setting. The whole row fires it, not just the switch. */
  onToggle: () => void;
};

/**
 * One switched setting, shared by the settings panel and the developer screen.
 * The entire row is the tap target rather than the switch alone, which is what
 * makes it hittable at arm's length on a dash mount.
 */
export const ToggleRow = ({
  label,
  description,
  on,
  onToggle,
}: ToggleRowProps) => (
  <button
    type="button"
    onClick={onToggle}
    className="flex min-h-16 items-center justify-between gap-6 py-4 text-left"
  >
    <span className="flex flex-col gap-1">
      <span className="text-lg font-semibold tracking-[0.06em] text-white/90">
        {label}
      </span>
      <span className="text-sm font-medium text-white/45">{description}</span>
    </span>
    <Toggle on={on} />
  </button>
);
