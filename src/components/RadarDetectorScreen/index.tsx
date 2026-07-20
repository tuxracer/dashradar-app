import { useEffect, useRef } from "react";
import {
  decayPeak,
  litSegments,
  signalColor,
  SEGMENT_COUNT,
} from "@/lib/radarSignal";

/** Props for RadarDetectorScreen. */
type RadarDetectorScreenProps = {
  /** Current raw police-signal strength in [0, 1] (see hudSignal). */
  confidence: number;
};

/**
 * Fullscreen radar-detector meter. Renders an opaque panel with a POLICE SIGNAL
 * label, a large percentage readout, and a segmented ladder colored green
 * through amber to red as the signal climbs. A requestAnimationFrame loop
 * applies peak-hold + decay to the incoming confidence and writes the lit
 * segments, their color, and the readout straight to the DOM, off React's
 * render path, so smoothness does not depend on the detector's frame rate.
 * The camera feed and bounding boxes are intentionally not shown in this mode.
 */
export const RadarDetectorScreen = ({
  confidence,
}: RadarDetectorScreenProps) => {
  const confidenceRef = useRef(confidence);
  const peakRef = useRef(0);
  const lastTimeRef = useRef<number | undefined>(undefined);
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const readoutRef = useRef<HTMLSpanElement>(null);

  // Refs may not be written during render; mirror the latest prop in via an
  // effect so the persistent rAF loop reads the current value without
  // re-subscribing (the same pattern HudOverlay uses).
  useEffect(() => {
    confidenceRef.current = confidence;
  }, [confidence]);

  useEffect(() => {
    let frame = 0;
    const tick = (now: number) => {
      const last = lastTimeRef.current ?? now;
      // Clamp dt so a backgrounded tab that resumes does not decay a huge step.
      const dtSec = Math.min(0.05, (now - last) / 1000);
      lastTimeRef.current = now;

      const level = decayPeak(peakRef.current, confidenceRef.current, dtSec);
      peakRef.current = level;

      const color = signalColor(level);
      const lit = litSegments(level, SEGMENT_COUNT);
      segmentRefs.current.forEach((segment, index) => {
        if (!segment) {
          return;
        }
        if (index < lit) {
          segment.style.backgroundColor = color;
          segment.style.boxShadow = `0 0 10px ${color}`;
        } else {
          segment.style.backgroundColor = "";
          segment.style.boxShadow = "";
        }
      });

      const readout = readoutRef.current;
      if (readout) {
        readout.textContent = `${Math.round(level * 100)}%`;
        readout.style.color = color;
      }

      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-8 bg-surface px-[6%]">
      <span className="text-sm font-semibold tracking-[0.34em] text-white/55">
        POLICE SIGNAL
      </span>
      <span
        ref={readoutRef}
        className="text-[20vw] font-bold leading-none tabular-nums text-white/90 landscape:text-[14vw]"
      >
        0%
      </span>
      <div className="flex w-full max-w-4xl gap-[1.2%]">
        {Array.from({ length: SEGMENT_COUNT }, (_, index) => (
          <div
            key={index}
            data-testid="signal-segment"
            ref={(element) => {
              segmentRefs.current[index] = element;
            }}
            className="h-6 flex-1 rounded-[3px] bg-white/10"
          />
        ))}
      </div>
    </div>
  );
};
