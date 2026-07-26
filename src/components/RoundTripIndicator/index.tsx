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
 * Amber pill showing how long the last scan's detect round trip took: the
 * whole capture-to-result message trip, not the model time alone, so it also
 * carries the crop, thumbnail, and JPEG encode work the frame-saving options
 * add. The on-glass counterpart of the debug overlay's round-trip row, for
 * watching pacing on a dash-mounted phone without the full panel covering the
 * meter. Visibility is the caller's job: RadarScreen renders it only while the
 * round-trip developer option is on, and places it in StatusBar's center slot.
 *
 * The value is polled from the debug snapshot ref rather than read from React
 * state, the same way DebugOverlay reads it: the snapshot deliberately lives
 * outside state so a per-result update doesn't re-render every consumer. Only
 * the number is held here, so an unchanged reading bails out of re-rendering.
 */
export const RoundTripIndicator = ({ getDebug }: RoundTripIndicatorProps) => {
  const [roundTripMs, setRoundTripMs] = useState(() => getDebug().roundTripMs);
  useEffect(() => {
    let frame = 0;
    let last = 0;
    const tick = (time: number) => {
      if (time - last > READOUT_INTERVAL_MS) {
        last = time;
        setRoundTripMs(getDebug().roundTripMs);
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [getDebug]);

  // A scan has yet to land, so there is no round trip to report. Zero would
  // read as an impossibly fast one.
  const label =
    roundTripMs > 0 ? `RT · ${Math.round(roundTripMs)} MS` : "RT · -- MS";
  return (
    <span className="pointer-events-none whitespace-nowrap rounded-full border border-hud-amber/45 px-3 py-0.5 text-[13px] font-semibold tabular-nums tracking-[0.22em] text-hud-amber">
      {label}
    </span>
  );
};
