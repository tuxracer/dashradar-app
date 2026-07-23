import { useEffect, useRef } from "react";
import type { Contact } from "@/context/DetectionContext";
import { createRadarBeeper } from "@/lib/radarAudio";
import type { RadarBeeper } from "@/lib/radarAudio";
import {
  decayPeak,
  litSegments,
  signalColor,
  SEGMENT_COUNT,
  SIGNAL_HIGH_COLOR,
} from "@/lib/radarSignal";
import { downloadBlob, frameFilename } from "@/lib/saveFrame";
import {
  ALERT_THRESHOLD,
  ARC_SWEEP_DEG,
  CONTACT_THRESHOLD,
  DIRECTION_DISPLAY,
} from "./consts";

export * from "./consts";

/** Props for RadarDetectorScreen. */
type RadarDetectorScreenProps = {
  /** Current raw police-signal strength in [0, 1] (see hudSignal). */
  confidence: number;
  /** Whether the beeping audio indicator is on (the radarAudio setting). */
  audioEnabled: boolean;
  /** Latest detection cutout to render as the contact card, if any. */
  contact?: Contact;
  /** Whether the debug setting is on; reveals the contact card's SAVE button. */
  debug?: boolean;
};

/** Arc angle for a segment, in degrees, 0 pointing straight up. */
const segmentAngleDeg = (index: number): number =>
  -ARC_SWEEP_DEG / 2 + (ARC_SWEEP_DEG / (SEGMENT_COUNT - 1)) * index;

const ALERT_RING_COLOR = `rgb(${SIGNAL_HIGH_COLOR.join(", ")})`;

/**
 * Fullscreen radar-detector instrument. The ladder segments are radial ticks
 * on a tachometer-style arc around a large percentage readout, over a faint
 * radar grid with a slow scanning sweep inside the dial. As the signal climbs
 * the ticks, readout, and a central glow flood green through amber to red; at
 * ALERT_THRESHOLD a red ring around the dial pulses. A requestAnimationFrame
 * loop applies peak-hold + decay to the incoming confidence and writes the lit
 * segments, colors, readout, status word, and glow straight to the DOM, off
 * React's render path, so smoothness does not depend on the detector's frame
 * rate. The camera feed and bounding boxes are intentionally not shown in this
 * mode. The same loop feeds a radar-detector beeper (see lib/radarAudio) the
 * raw signal rather than the peak-held level, so the beeps cut off as soon as
 * the detection is gone while the dial decays smoothly behind them; the beeper
 * exists only while this mode is mounted, and audioEnabled false feeds it
 * silence instead. The contact card's direction row follows the same rule as
 * the audio: it renders only while the raw signal is nonzero (a live
 * detection), so a stale heading is never shown while the card lingers
 * through the dial's decay tail. While the debug setting is on and the
 * contact carries the full inference frame, the card also shows a SAVE
 * button that downloads that frame as a JPEG for collecting training data.
 */
export const RadarDetectorScreen = ({
  confidence,
  audioEnabled,
  contact,
  debug,
}: RadarDetectorScreenProps) => {
  const confidenceRef = useRef(confidence);
  const audioEnabledRef = useRef(audioEnabled);
  const contactRef = useRef(contact);
  const beeperRef = useRef<RadarBeeper | undefined>(undefined);
  const peakRef = useRef(0);
  const lastTimeRef = useRef<number | undefined>(undefined);
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement>(null);

  // Refs may not be written during render; mirror the latest prop in via an
  // effect so the persistent rAF loop reads the current value without
  // re-subscribing.
  useEffect(() => {
    confidenceRef.current = confidence;
  }, [confidence]);

  useEffect(() => {
    audioEnabledRef.current = audioEnabled;
  }, [audioEnabled]);

  useEffect(() => {
    contactRef.current = contact;
  }, [contact]);

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
    let frame = 0;
    const tick = (now: number) => {
      const last = lastTimeRef.current ?? now;
      // Clamp dt so a backgrounded tab that resumes does not decay a huge step.
      const dtSec = Math.min(0.05, (now - last) / 1000);
      lastTimeRef.current = now;

      const level = decayPeak(peakRef.current, confidenceRef.current, dtSec);
      peakRef.current = level;

      // Feed the audio the raw signal, not the peak-held meter level: the
      // beeps stop the instant the detection is gone instead of winding down
      // with the dial's decay tail. A disabled toggle feeds silence instead.
      beeperRef.current?.update(
        audioEnabledRef.current ? confidenceRef.current : 0,
        now,
      );

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

      const hasSignal = level >= CONTACT_THRESHOLD;
      const readout = readoutRef.current;
      if (readout) {
        readout.textContent = `${Math.round(level * 100)}%`;
        readout.style.color = hasSignal ? color : "";
      }

      const status = statusRef.current;
      if (status) {
        status.textContent = hasSignal ? "ALERT" : "SCANNING";
        status.style.color = hasSignal ? color : "";
      }

      const glow = glowRef.current;
      if (glow) {
        glow.style.background = `radial-gradient(closest-side, ${color} 0%, transparent 70%)`;
        glow.style.opacity = String(0.04 + 0.26 * level);
      }

      // The pulsing alert ring is CSS-driven off this data attribute (see the
      // group-data-[alert=true] classes below).
      const screen = screenRef.current;
      if (screen) {
        screen.dataset.alert = String(level >= ALERT_THRESHOLD);
        screen.dataset.contact = String(
          level > 0 && contactRef.current !== undefined,
        );
      }

      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const frameBlob = contact?.frame;

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
        <div
          className="absolute inset-[24%] animate-spin rounded-full [animation-duration:5s] motion-reduce:animate-none"
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
          <span className="text-[11px] font-semibold tracking-[0.34em] text-white/50">
            POLICE SIGNAL
          </span>
          <span
            ref={readoutRef}
            className="text-[min(17vmin,6.5rem)] font-bold leading-none tabular-nums text-white/90"
          >
            0%
          </span>
          <span
            ref={statusRef}
            data-testid="signal-status"
            className="text-[13px] font-semibold tracking-[0.3em] text-white/40"
          >
            SCANNING
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
          {confidence > 0 && (
            <div className="flex items-center justify-center px-3 pb-2 text-sm font-semibold">
              <span
                data-testid="contact-direction"
                className="tracking-[0.2em] text-white/75"
              >
                {DIRECTION_DISPLAY[contact.direction]}
              </span>
            </div>
          )}
          {debug && frameBlob && (
            <button
              data-testid="contact-save"
              onClick={() => downloadBlob(frameBlob, frameFilename(new Date()))}
              className="mx-3 mb-3 rounded-md border border-hud-amber/40 bg-hud-amber/10 py-4 text-sm font-semibold tracking-[0.3em] text-hud-amber transition-colors active:border-hud-amber active:bg-hud-amber active:text-surface"
            >
              SAVE
            </button>
          )}
        </div>
      )}
    </div>
  );
};
