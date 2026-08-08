import { useSyncExternalStore } from "react";
import { prefersReducedMotion } from "@/utils/prefersReducedMotion";
import { STROBE_PERIOD_MS } from "./consts";

/** Which half of a police lightbar is lit, or steady under reduced motion. */
export type StrobePhase = "red" | "blue" | undefined;

let phase: StrobePhase = "red";

let timer: ReturnType<typeof setInterval> | undefined;

const listeners = new Set<() => void>();

const flip = () => {
  phase = phase === "red" ? "blue" : "red";
  for (const listener of listeners) {
    listener();
  }
};

/**
 * The interval runs only while a police glyph is subscribed, which is what
 * keeps the strobe off the clock for the whole of a normal drive.
 */
const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  timer ??= setInterval(flip, STROBE_PERIOD_MS);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
      phase = "red";
    }
  };
};

const snapshot = () => phase;

/** Never subscribes, so reduced motion starts no timer at all. */
const subscribeSteady = () => () => {};

const steady = () => undefined;

/**
 * The lit half of every police lightbar on screen. One timer drives all of them,
 * so patrol cars flash together rather than each paying for its own clock; that
 * they alternate is the whole message at these ranges.
 *
 * A strobe is a step function, so this is a millisecond cadence rather than a rAF
 * loop, and the scene renders once per flip. Reduced motion pins it steady.
 */
export const usePoliceStrobe = (): StrobePhase => {
  const reduced = prefersReducedMotion();
  return useSyncExternalStore(
    reduced ? subscribeSteady : subscribe,
    reduced ? steady : snapshot,
    steady,
  );
};
