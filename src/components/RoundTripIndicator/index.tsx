import { useEffect, useState } from "react";
import type { DebugSnapshot } from "@/context/DetectionContext";
import { READOUT_INTERVAL_MS } from "./consts";

export * from "./consts";

/** Props for RoundTripIndicator. */
type RoundTripIndicatorProps = {
  /** Latest per-frame diagnostics; polled on the readout tick. */
  getDebug: () => DebugSnapshot;
};

/**
 * Amber pill showing the last scan's whole detect round trip, not the model time
 * alone. The on-glass counterpart of the debug overlay's round-trip row, for
 * watching pacing on a phone without the panel covering the meter; the caller
 * owns its visibility.
 *
 * Polled from the debug snapshot rather than React state, which is where the
 * snapshot deliberately lives so a per-result update does not re-render every
 * consumer. An interval rather than an animation frame, because the readout is
 * paced in wall time and has nothing to say between ticks.
 */
export const RoundTripIndicator = ({ getDebug }: RoundTripIndicatorProps) => {
  const [roundTripMs, setRoundTripMs] = useState(() => getDebug().roundTripMs);
  useEffect(() => {
    const readout = window.setInterval(() => {
      setRoundTripMs(getDebug().roundTripMs);
    }, READOUT_INTERVAL_MS);
    return () => window.clearInterval(readout);
  }, [getDebug]);

  // No scan yet; zero would read as an impossibly fast round trip.
  const label =
    roundTripMs > 0 ? `RT · ${Math.round(roundTripMs)} MS` : "RT · -- MS";
  return (
    <span className="pointer-events-none whitespace-nowrap rounded-full border border-hud-amber/45 px-3 py-0.5 text-[13px] font-semibold tabular-nums tracking-[0.22em] text-hud-amber">
      {label}
    </span>
  );
};
