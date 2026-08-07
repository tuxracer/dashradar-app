import { useEffect, useRef } from "react";
import type { Contact } from "@/context/DetectionContext";
import {
  initialMeterState,
  litSegments,
  signalColor,
  stepMeter,
  SEGMENT_COUNT,
  SIGNAL_HIGH_COLOR,
} from "@/lib/radarSignal";
import { useRadarBeeper } from "@/utils/useRadarBeeper";
import {
  ARC_SWEEP_DEG,
  DIRECTION_DISPLAY,
  RAW_CONFIDENCE_DECIMALS,
} from "./consts";

export * from "./consts";

/** Props for RadarDetectorScreen. */
type RadarDetectorScreenProps = {
  /** Current raw signal strength in [0, 1] (see hudSignal). */
  confidence: number;
  /** Whether the beeping audio indicator is on (the radarAudio setting). */
  audioEnabled: boolean;
  /** Latest cutout to render as the contact card, if any. */
  contact?: Contact;
  /** Detection has not started yet; no sweep, and the word reads INITIALIZING. */
  initializing?: boolean;
  /**
   * Raw model score to show in place of the percentage, which comes off a
   * remapped signal band and never matches it. Shown live with no peak-hold, so
   * it drops to zero the moment the detection clears.
   */
  rawConfidence?: number;
  /**
   * Class the meter is alerting on, named by the status word in place of ALERT.
   * Clears for the whole decay tail, which is why the loop holds the last one
   * rather than reading this directly.
   */
  detectedLabel?: string;
};

/** Arc angle for a segment, in degrees, 0 pointing straight up. */
const segmentAngleDeg = (index: number): number =>
  -ARC_SWEEP_DEG / 2 + (ARC_SWEEP_DEG / (SEGMENT_COUNT - 1)) * index;

const ALERT_RING_COLOR = `rgb(${SIGNAL_HIGH_COLOR.join(", ")})`;

/**
 * Fullscreen radar-detector instrument: radial ticks on a tachometer arc around
 * a percentage readout, over a faint grid with a sweep turning inside the dial.
 * A rAF loop applies peak-hold and decay to the incoming confidence and writes
 * segments, colors, readout, status word, and glow straight to the DOM, off
 * React's render path. It parks itself once the meter is quiescent and any prop
 * change wakes it, so the idle scanning state that dominates a session schedules
 * no frames at all; while awake it skips writes whose values have not changed.
 *
 * The status word names the detected class, holding the last one through the
 * dial's decay tail rather than reading the prop, which clears the instant the
 * raw signal does. The beeper and the contact card's direction row take the raw
 * signal instead, so both cut off with the detection while the dial decays
 * behind them.
 *
 * The sweep turns at a steady pace of its own rather than tracking the scan
 * rate, which it never usefully could: scans land about a second apart, so a
 * wedge stepped per scan reads as a stutter. It is withheld until scanning is
 * live, which is what makes its arrival mean something, and stays dark under
 * reduced motion with the status word carrying liveness alone.
 */
export const RadarDetectorScreen = ({
  confidence,
  audioEnabled,
  contact,
  initializing,
  rawConfidence,
  detectedLabel,
}: RadarDetectorScreenProps) => {
  const confidenceRef = useRef(confidence);
  const contactRef = useRef(contact);
  const initializingRef = useRef(initializing);
  const rawConfidenceRef = useRef(rawConfidence);
  const detectedLabelRef = useRef(detectedLabel);
  const meterRef = useRef(initialMeterState());
  const lastTimeRef = useRef<number | undefined>(undefined);
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);
  // Restarts the rAF loop when it has parked itself on an idle meter. A no-op
  // while it is already running, so the mirror effects call it unconditionally.
  const wakeRef = useRef<() => void>(() => {});

  // Lives exactly as long as this screen, and takes the raw signal rather than
  // the peak-held level, so the beeps cut off with the detection.
  useRadarBeeper(confidence, audioEnabled);

  // Refs may not be written during render, so each prop is mirrored in through
  // an effect that also wakes the loop, flushing the change even when idle.
  useEffect(() => {
    confidenceRef.current = confidence;
    wakeRef.current();
  }, [confidence]);

  useEffect(() => {
    contactRef.current = contact;
    wakeRef.current();
  }, [contact]);

  useEffect(() => {
    initializingRef.current = initializing;
    wakeRef.current();
  }, [initializing]);

  useEffect(() => {
    rawConfidenceRef.current = rawConfidence;
    wakeRef.current();
  }, [rawConfidence]);

  useEffect(() => {
    detectedLabelRef.current = detectedLabel;
    wakeRef.current();
  }, [detectedLabel]);

  // The canvas takes the bitmap's intrinsic size; CSS scales it to the card.
  useEffect(() => {
    const canvas = cropCanvasRef.current;
    if (!canvas || !contact) {
      return;
    }
    // A closed ImageBitmap reports 0x0 dimensions; drawImage would throw.
    if (contact.image.width === 0) {
      return;
    }
    canvas.width = contact.image.width;
    canvas.height = contact.image.height;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.drawImage(contact.image, 0, 0);
  }, [contact]);

  useEffect(() => {
    let disposed = false;
    let running = false;
    let frame = 0;
    // Values behind the last flush. While all hold, every write would rewrite an
    // identical value, so a steady alert does not churn the DOM at refresh rate.
    let writtenLevel: number | undefined;
    let writtenContactShown: boolean | undefined;
    let writtenStatus: string | undefined;
    // A sentinel distinct from any real prop value, so the first tick always
    // flushes the readout mode.
    let writtenRawConfidence: number | undefined | null = null;

    const tick = (now: number) => {
      const last = lastTimeRef.current ?? now;
      // Clamp dt so a backgrounded tab that resumes does not decay a huge step.
      const dtSec = Math.min(0.05, (now - last) / 1000);
      lastTimeRef.current = now;

      // The display state machine is the pure stepMeter; this loop only writes
      // what it says and parks.
      const { state, display } = stepMeter(
        meterRef.current,
        {
          signal: confidenceRef.current,
          detectedLabel: detectedLabelRef.current,
          contactPresent: contactRef.current !== undefined,
        },
        dtSec,
      );
      meterRef.current = state;
      const { level, hasSignal, contactShown } = display;

      // Flips the status word at a zero meter, so it gates the flush too.
      const isInitializing = initializingRef.current === true;

      // Gates the flush too, since it can change while the peak-held level does
      // not: a new same-strength detection, or the option toggling while idle.
      const raw = rawConfidenceRef.current;

      // ALERT is the fallback for a signal with no class to name, which the real
      // app does not produce but which keeps the word honest if it ever does.
      const statusText = hasSignal
        ? display.heldLabel !== undefined
          ? `${display.heldLabel} DETECTED`
          : "ALERT"
        : isInitializing
          ? "INITIALIZING"
          : "SCANNING";

      if (
        level !== writtenLevel ||
        contactShown !== writtenContactShown ||
        statusText !== writtenStatus ||
        raw !== writtenRawConfidence
      ) {
        writtenLevel = level;
        writtenContactShown = contactShown;
        writtenStatus = statusText;
        writtenRawConfidence = raw;

        const color = signalColor(level);
        const lit = litSegments(level, SEGMENT_COUNT);
        segmentRefs.current.forEach((segment, index) => {
          if (!segment) {
            return;
          }
          if (index < lit) {
            segment.style.backgroundColor = color;
            segment.style.boxShadow = `0 0 12px ${color}`;
          } else {
            segment.style.backgroundColor = "";
            segment.style.boxShadow = "";
          }
        });

        const readout = readoutRef.current;
        if (readout) {
          readout.textContent =
            raw !== undefined
              ? raw.toFixed(RAW_CONFIDENCE_DECIMALS)
              : `${Math.round(level * 100)}%`;
          readout.style.color = hasSignal ? color : "";
        }

        const status = statusRef.current;
        if (status) {
          status.textContent = statusText;
          status.style.color = hasSignal ? color : "";
        }

        const glow = glowRef.current;
        if (glow) {
          glow.style.background = `radial-gradient(closest-side, ${color} 0%, transparent 70%)`;
          glow.style.opacity = String(0.04 + 0.26 * level);
        }

        // The pulsing alert ring is CSS-driven off this attribute.
        const screen = screenRef.current;
        if (screen) {
          screen.dataset.alert = String(display.alert);
          screen.dataset.contact = String(contactShown);
        }
      }

      // Park once the meter is quiescent, which is the dominant state of a
      // scanning session: every write above is a fixed point, so further frames
      // would only spend battery. The mirror effects wake the loop on any prop
      // change, so it always runs one more tick to flush it.
      if (confidenceRef.current === 0 && level === 0) {
        running = false;
        lastTimeRef.current = undefined;
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };

    const wake = () => {
      if (disposed || running) {
        return;
      }
      running = true;
      frame = window.requestAnimationFrame(tick);
    };
    wakeRef.current = wake;
    wake();
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={screenRef}
      data-alert="false"
      data-contact="false"
      className="group absolute inset-0 flex items-center justify-center bg-surface"
      style={{
        backgroundImage:
          "linear-gradient(rgba(255,179,64,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,179,64,0.06) 1px, transparent 1px)",
        backgroundSize: "40px 40px",
      }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.6) 100%)",
        }}
      />
      <div className="relative aspect-square w-[min(84vmin,28rem)] translate-y-[3%]">
        <div ref={glowRef} className="absolute inset-[6%] rounded-full" />
        <div className="absolute inset-[24%] rounded-full border border-hud-amber/15" />
        {/* Unmounted rather than hidden while initializing, so nothing is
            composited before there is a detector to report on. Reduced motion
            hides it instead of freezing it: a bright wedge parked at an angle
            is what a broken sweep looks like. */}
        {!initializing && (
          <div
            data-testid="sweep-wedge"
            className="absolute inset-[24%] animate-radar-sweep rounded-full motion-reduce:hidden"
            style={{
              background:
                "conic-gradient(from 0deg, rgba(255,179,64,0.28) 0deg, rgba(255,179,64,0.04) 60deg, transparent 70deg)",
            }}
          />
        )}
        <div
          className="absolute inset-[21%] rounded-full border-2 opacity-0 group-data-[alert=true]:animate-pulse group-data-[alert=true]:opacity-100 motion-reduce:animate-none"
          style={{ borderColor: ALERT_RING_COLOR }}
        />
        {Array.from({ length: SEGMENT_COUNT }, (_, index) => (
          <div
            key={index}
            data-testid="signal-segment"
            ref={(element) => {
              segmentRefs.current[index] = element;
            }}
            className="absolute left-1/2 top-1/2 rounded-full bg-white/10"
            style={{
              width: "5%",
              height: "14%",
              transform: `translate(-50%, -50%) rotate(${segmentAngleDeg(index)}deg) translateY(-290%)`,
            }}
          />
        ))}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            ref={readoutRef}
            className="text-[min(17vmin,6.5rem)] font-bold leading-none tabular-nums text-white/90"
          >
            {rawConfidence !== undefined
              ? rawConfidence.toFixed(RAW_CONFIDENCE_DECIMALS)
              : "0%"}
          </span>
          <span
            ref={statusRef}
            data-testid="signal-status"
            className="whitespace-nowrap text-[13px] font-semibold uppercase tracking-[0.24em] text-white/40"
          >
            {initializing ? "INITIALIZING" : "SCANNING"}
          </span>
        </div>
      </div>
      {contact && (
        <div
          data-testid="contact-card"
          className="invisible absolute right-[4%] top-1/2 flex max-h-[72%] w-[24%] -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-hud-amber/40 bg-surface/90 opacity-0 [transition:opacity_500ms,visibility_0s_500ms] group-data-[contact=true]:visible group-data-[contact=true]:opacity-100 group-data-[contact=true]:[transition:opacity_500ms] portrait:bottom-[4%] portrait:left-1/2 portrait:right-auto portrait:top-auto portrait:w-[56%] portrait:-translate-x-1/2 portrait:translate-y-0"
        >
          <canvas
            ref={cropCanvasRef}
            className="min-h-0 w-full flex-1 object-contain px-3 py-2"
          />
          {confidence > 0 && contact.direction && (
            <div className="flex items-center justify-center px-3 pb-2 text-sm font-semibold">
              <span
                data-testid="contact-direction"
                className="tracking-[0.2em] text-white/75"
              >
                {DIRECTION_DISPLAY[contact.direction]}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
