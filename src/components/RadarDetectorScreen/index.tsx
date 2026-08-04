import { useEffect, useRef } from "react";
import type { Contact } from "@/context/DetectionContext";
import { createRadarBeeper } from "@/lib/radarAudio";
import type { RadarBeeper } from "@/lib/radarAudio";
import {
  initialMeterState,
  litSegments,
  signalColor,
  stepMeter,
  SEGMENT_COUNT,
  SIGNAL_HIGH_COLOR,
} from "@/lib/radarSignal";
import { prefersReducedMotion } from "@/utils/prefersReducedMotion";
import {
  ARC_SWEEP_DEG,
  DIRECTION_DISPLAY,
  RAW_CONFIDENCE_DECIMALS,
  SWEEP_STEP_DEG,
  SWEEP_STEP_MS,
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
  /**
   * Whether detection has not started yet (model loading, session warm-up).
   * The status word reads INITIALIZING instead of SCANNING.
   */
  initializing?: boolean;
  /**
   * performance.now() timestamp of the latest completed scan, empty or not
   * (the engine's scan.at). Each new value advances the sweep one arc step,
   * so the dial's sweep cadence is the real scan cadence; undefined before
   * the first result keeps the sweep dark.
   */
  scanAt?: number;
  /**
   * Raw model score in [0, 1] to show in the dial readout in place of the
   * percentage (the raw-confidence developer option). The percentage derives
   * from the confidence prop, a remapped signal band that never matches the
   * model's own score, so this is the readout for judging the model rather
   * than the meter. Shown live with no peak-hold, so it drops to zero the
   * moment the detection clears while the dial decays behind it. Undefined
   * (the option off) shows the percentage.
   */
  rawConfidence?: number;
  /**
   * Display label of the class the meter is alerting on (the HUD's
   * highest-scoring detection), which the status word names in place of the
   * generic ALERT. Undefined when nothing is detected, and also for the whole
   * decay tail after a detection clears, which is why the loop holds the last
   * one rather than reading this directly.
   */
  detectedLabel?: string;
};

/** Arc angle for a segment, in degrees, 0 pointing straight up. */
const segmentAngleDeg = (index: number): number =>
  -ARC_SWEEP_DEG / 2 + (ARC_SWEEP_DEG / (SEGMENT_COUNT - 1)) * index;

const ALERT_RING_COLOR = `rgb(${SIGNAL_HIGH_COLOR.join(", ")})`;

/**
 * Fullscreen radar-detector instrument. The ladder segments are radial ticks
 * on a tachometer-style arc around a large percentage readout, over a faint
 * radar grid with a scanning sweep inside the dial that advances one arc
 * step per completed scan (the scanAt prop), so its cadence is the
 * detector's real scan rate. As the signal climbs
 * the ticks, readout, and a central glow flood green through amber to red; at
 * ALERT_THRESHOLD a red ring around the dial pulses. The status word under the
 * readout names the class being detected (the detectedLabel prop, which is
 * the HUD's highest-scoring detection), falling back to ALERT for a signal
 * with no class to name. It keeps naming that class for as long as the meter
 * registers a contact at all, which means through the dial's decay tail
 * rather than only while the detection is live: the prop clears the instant
 * the raw signal does, so the loop holds the last label instead of reading
 * the prop directly. Below CONTACT_THRESHOLD the word reverts to SCANNING,
 * and the held label is dropped once the meter reaches zero so the next
 * detection starts clean. A requestAnimationFrame loop applies peak-hold +
 * decay to the incoming confidence and writes the lit segments, colors,
 * readout, status word, and glow straight to the DOM, off React's render
 * path. Before detection has started (the initializing prop) the instrument
 * still renders in full, but the status word reads INITIALIZING and the
 * sweep wedge is hidden, so the first paint is the dial rather than a blank
 * screen and the sweep's arrival signals that scanning is actually live.
 * The sweep is a one-shot Web Animations step per result rather than a
 * looping CSS animation on purpose: a session is hours long, a perpetual
 * spin keeps the compositor producing frames (and the panel refreshing) the
 * whole time, and stepping only when a scan lands leaves the compositor
 * idle whenever the pacing rests, exactly when a hot device needs it. Each
 * step moves at the pace of the 5 s spin it replaced (SWEEP_REVOLUTION_MS),
 * so at floor pacing the chained steps look like the original rotation and
 * the wedge simply parks in place when scanning pauses or stops. The
 * rAF loop runs off React's render path, so smoothness does not depend on
 * the detector's frame rate. The loop parks itself once the meter is
 * quiescent (no raw signal and a fully decayed peak) and any prop change
 * wakes it, so the idle scanning state, which dominates a session, schedules
 * no animation frames and does no per-frame work; while awake it also skips
 * DOM writes whenever the values behind them have not changed. The camera
 * feed and bounding boxes are intentionally not shown in this mode. The same
 * loop feeds a radar-detector beeper (see lib/radarAudio) the raw signal
 * rather than the peak-held level, so the beeps cut off as soon as the
 * detection is gone while the dial decays smoothly behind them; the beeper
 * exists only while this mode is mounted, and audioEnabled false feeds it
 * silence instead. The contact card's direction row follows the same rule as
 * the audio: it renders only while the raw signal is nonzero (a live
 * detection), so a stale heading is never shown while the card lingers
 * through the dial's decay tail. A developer option swaps the dial's
 * percentage for the raw model score (the rawConfidence prop) while the
 * ladder keeps tracking the peak-held signal.
 */
export const RadarDetectorScreen = ({
  confidence,
  audioEnabled,
  contact,
  initializing,
  scanAt,
  rawConfidence,
  detectedLabel,
}: RadarDetectorScreenProps) => {
  const confidenceRef = useRef(confidence);
  const audioEnabledRef = useRef(audioEnabled);
  const contactRef = useRef(contact);
  const initializingRef = useRef(initializing);
  const rawConfidenceRef = useRef(rawConfidence);
  const detectedLabelRef = useRef(detectedLabel);
  const beeperRef = useRef<RadarBeeper | undefined>(undefined);
  const meterRef = useRef(initialMeterState());
  const lastTimeRef = useRef<number | undefined>(undefined);
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const sweepRef = useRef<HTMLDivElement>(null);
  const sweepAnimationRef = useRef<Animation | undefined>(undefined);
  // Where the wedge is parked, in degrees; each scan's step starts here.
  const sweepAngleRef = useRef(0);
  const screenRef = useRef<HTMLDivElement>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);
  // Restarts the rAF loop when it has parked itself on an idle meter (see the
  // loop effect below). A no-op while the loop is already running, so the
  // mirror effects can call it unconditionally on every prop change.
  const wakeRef = useRef<() => void>(() => {});

  // Refs may not be written during render; mirror the latest prop in via an
  // effect so the persistent rAF loop reads the current value without
  // re-subscribing. Each mirror also wakes the parked loop so the change is
  // flushed to the DOM even when the meter is idle.
  useEffect(() => {
    confidenceRef.current = confidence;
    wakeRef.current();
  }, [confidence]);

  useEffect(() => {
    audioEnabledRef.current = audioEnabled;
    wakeRef.current();
  }, [audioEnabled]);

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

  // One sweep step per completed scan. Keyed on the scan timestamp, not any
  // detection state, so empty results sweep too; the sweep reports "the road
  // was scanned", not "something was found". The step starts where the last
  // one ended (fill keeps the wedge parked there), so a result landing early
  // continues the rotation rather than snapping it; the superseded animation
  // is cancelled only after its replacement starts, in the same task, so no
  // frame paints the wedge at the unfilled base angle.
  useEffect(() => {
    const sweep = sweepRef.current;
    // jsdom implements no Web Animations API, so the sweep never fires there.
    if (scanAt === undefined || !sweep || typeof sweep.animate !== "function") {
      return;
    }
    if (prefersReducedMotion()) {
      return;
    }
    const from = sweepAngleRef.current;
    const to = from + SWEEP_STEP_DEG;
    sweepAngleRef.current = to % 360;
    const superseded = sweepAnimationRef.current;
    sweepAnimationRef.current = sweep.animate(
      [{ transform: `rotate(${from}deg)` }, { transform: `rotate(${to}deg)` }],
      { duration: SWEEP_STEP_MS, easing: "linear", fill: "forwards" },
    );
    superseded?.cancel();
  }, [scanAt]);

  // Draw the cutout into the card's canvas whenever it changes. The canvas
  // takes the bitmap's intrinsic size; CSS scales it to fit the card.
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

  // The beeper lives exactly as long as this screen: leaving radar detector
  // mode (or unmounting for any reason) tears the audio graph down.
  useEffect(() => {
    const beeper = createRadarBeeper();
    beeperRef.current = beeper;
    return () => {
      beeper.dispose();
      beeperRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let running = false;
    let frame = 0;
    // Values behind the last DOM flush. While all hold, every write below
    // would rewrite an identical value, so the flush is skipped and a steady
    // alert does not churn styles and text at display refresh rate.
    let writtenLevel: number | undefined;
    let writtenContactShown: boolean | undefined;
    let writtenStatus: string | undefined;
    // Sentinel distinct from any real prop value (a number or undefined), so
    // the first tick always flushes the readout mode.
    let writtenRawConfidence: number | undefined | null = null;

    const tick = (now: number) => {
      const last = lastTimeRef.current ?? now;
      // Clamp dt so a backgrounded tab that resumes does not decay a huge step.
      const dtSec = Math.min(0.05, (now - last) / 1000);
      lastTimeRef.current = now;

      // The display state machine (peak-hold decay, held label, thresholds)
      // is the pure stepMeter; this loop only writes what it says and parks.
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

      // Feed the audio the raw signal, not the peak-held meter level: the
      // beeps stop the instant the detection is gone instead of winding down
      // with the dial's decay tail. A disabled toggle feeds silence instead.
      // Runs every awake tick, outside the changed-values gate, because the
      // beep cadence is paced by repeated calls at a steady level.
      beeperRef.current?.update(
        audioEnabledRef.current ? confidenceRef.current : 0,
        now,
      );

      // The status word flips between INITIALIZING and SCANNING at a zero
      // meter, so the initializing flag gates the flush alongside the level.
      const isInitializing = initializingRef.current === true;

      // The raw model score shown in place of the percentage when the
      // raw-confidence developer option is on (undefined otherwise). Gates the
      // flush alongside the level because it can change while the peak-held
      // level does not (a new same-strength detection, or the option toggling
      // at an idle meter).
      const raw = rawConfidenceRef.current;

      // ALERT is the fallback for a signal with no class to name, which the
      // real app does not produce (a nonzero signal means a detection, and a
      // detection has a class) but which keeps the word honest if it ever does.
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

        // The pulsing alert ring is CSS-driven off this data attribute (see
        // the group-data-[alert=true] classes below).
        const screen = screenRef.current;
        if (screen) {
          screen.dataset.alert = String(display.alert);
          screen.dataset.contact = String(contactShown);
        }
      }

      // Park the loop once the meter is quiescent: no raw signal and a fully
      // decayed peak make every write above a fixed point, so further frames
      // would only spend battery. This is the dominant state of a scanning
      // session on a dash-mounted phone. The mirror effects wake the loop on
      // any prop change, so it always runs at least one tick to flush the
      // change (and the beeper) before parking again.
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
        {/* The sweep wedge fades in with the first scan and then parks
            between the arc steps the scanAt effect above drives; a parked
            wedge is static and costs the compositor nothing. */}
        <div
          ref={sweepRef}
          className={`absolute inset-[24%] rounded-full transition-opacity duration-700 ${
            scanAt === undefined ? "opacity-0" : "opacity-100"
          }`}
          style={{
            background:
              "conic-gradient(from 0deg, rgba(255,179,64,0.28) 0deg, rgba(255,179,64,0.04) 60deg, transparent 70deg)",
          }}
        />
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
