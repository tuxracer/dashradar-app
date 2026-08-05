import { useEffect, useRef } from "react";
import { createRadarBeeper } from "@/lib/radarAudio";

/**
 * Runs the radar-detector beeper (see lib/radarAudio) for as long as the
 * calling view is mounted, fed the raw signal rather than any smoothed or
 * peak-held level, so the beeps stop the instant the detection is gone. Both
 * driver-facing views need this and neither owns the other, which is why it
 * lives here rather than in one of them.
 *
 * The beeper has to be called repeatedly at a steady level, because that is
 * what paces the beep cadence, so this owns a requestAnimationFrame loop. The
 * loop parks itself the moment it feeds silence, which is also what arms the
 * beeper's own idle suspend, and a change to either input wakes it again. Quiet
 * scanning is the dominant state of a drive, and it schedules no frames at all.
 *
 * `audioEnabled` false feeds silence rather than skipping the update, so a
 * beeper mid-alert when the setting is turned off falls quiet instead of
 * holding its last state.
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
