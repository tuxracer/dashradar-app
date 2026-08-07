import { useEffect, useRef } from "react";
import { createRadarBeeper } from "@/lib/radarAudio";

/**
 * Runs the beeper for as long as the calling view is mounted, fed the raw signal
 * rather than a smoothed one so the beeps stop the instant the detection is
 * gone. Shared because both driver-facing views need it and neither owns the
 * other.
 *
 * The beeper is paced by being called repeatedly, so this owns a rAF loop. It
 * parks the moment it feeds silence, which also arms the beeper's own idle
 * suspend, and either input wakes it: quiet scanning dominates a drive and
 * schedules no frames at all. `audioEnabled` false feeds silence rather than
 * skipping the update, so a beeper mid-alert falls quiet instead of holding.
 */
export const useRadarBeeper = (confidence: number, audioEnabled: boolean) => {
  const confidenceRef = useRef(confidence);
  const audioEnabledRef = useRef(audioEnabled);
  // Restarts the loop when it has parked itself on silence. A no-op while it is
  // already running, so the mirrors below can call it unconditionally.
  const wakeRef = useRef<() => void>(() => {});

  // Refs may not be written during render, so mirror each input in through an
  // effect; the loop then reads the current value without re-subscribing.
  useEffect(() => {
    confidenceRef.current = confidence;
    wakeRef.current();
  }, [confidence]);

  useEffect(() => {
    audioEnabledRef.current = audioEnabled;
    wakeRef.current();
  }, [audioEnabled]);

  useEffect(() => {
    const beeper = createRadarBeeper();
    let disposed = false;
    let running = false;
    let frame = 0;
    const tick = (now: number) => {
      const level = audioEnabledRef.current ? confidenceRef.current : 0;
      beeper.update(level, now);
      if (level === 0) {
        running = false;
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
      wakeRef.current = () => {};
      beeper.dispose();
    };
  }, []);
};
