import { isBoolean, isNumber, isPlainObject, isString } from "remeda";

/**
 * Which view was on screen when a session ended. Recorded because the three
 * cost very different things to keep running: the scene view holds a WebGL
 * context open beside the WebGPU one the detector runs on, and the detection
 * view draws the full camera feed. A crash that only ever happens under one of
 * them is a different bug from one that happens under all three, and there is
 * no way to tell those apart after the fact without writing it down first.
 */
export type ActiveView = "radar" | "scene" | "detection";

const ACTIVE_VIEWS: readonly ActiveView[] = ["radar", "scene", "detection"];

/** Validates a value read back from localStorage as an ActiveView. */
export const isActiveView = (value: unknown): value is ActiveView =>
  isString(value) && ACTIVE_VIEWS.includes(value as ActiveView);

/**
 * Snapshot of an in-progress detection session, written to localStorage on a
 * heartbeat cadence while scanning runs so the next launch can tell whether
 * this one ended cleanly. `startedAt`/`lastBeatAt` are `Date.now()` epoch ms
 * (never `performance.now()`, which resets every page load and so cannot be
 * compared across launches). `graphCapture` is absent until the worker has
 * reported it. `release` is the build that wrote the record (optional only for
 * records written by builds predating the field), reported alongside the
 * reporting build's own release so a crash can be attributed to the deploy
 * that produced it.
 */
export type SentinelRecord = {
  startedAt: number;
  lastBeatAt: number;
  /**
   * Round trips the pump completed, counting the ones the scene-change gate
   * answered without running the model. Keeps that meaning rather than
   * narrowing to real scans, because reports already in hand were written
   * under it and a field that quietly changes what it counts makes every
   * comparison across the change wrong without looking wrong.
   */
  framesProcessed: number;
  /**
   * How many of those actually ran the model. Absent on records written by
   * builds that counted only the total; the difference against
   * framesProcessed is how many frames the gate answered for free.
   */
  scansProcessed?: number;
  graphCapture?: boolean;
  release?: string;
  activeView?: ActiveView;
  /**
   * The running model, named the way anything leaving the device has to name
   * one: a built-in by its slug, anything added as "custom".
   */
  model?: string;
};

/** Validates a value parsed from localStorage before it is trusted as a SentinelRecord. */
export const isSentinelRecord = (value: unknown): value is SentinelRecord => {
  return (
    isPlainObject(value) &&
    isNumber(value.startedAt) &&
    isNumber(value.lastBeatAt) &&
    isNumber(value.framesProcessed) &&
    (value.scansProcessed === undefined || isNumber(value.scansProcessed)) &&
    (value.graphCapture === undefined || isBoolean(value.graphCapture)) &&
    (value.release === undefined || isString(value.release)) &&
    (value.activeView === undefined || isActiveView(value.activeView)) &&
    (value.model === undefined || isString(value.model))
  );
};

/**
 * How the previous session ended: "crash" when the OS killed the page and
 * relaunched it almost immediately, "unclean" when the last heartbeat is
 * older than that (battery death, manual restart, deliberate shutdown).
 */
export type SessionEndOutcome = "crash" | "unclean";

/** Classification of a previous session's dirty end, derived from its sentinel record. */
export type PreviousSessionEnd = {
  outcome: SessionEndOutcome;
  gapMs: number;
  uptimeMs: number;
  framesProcessed: number;
  scansProcessed?: number;
  graphCapture?: boolean;
  release?: string;
  activeView?: ActiveView;
  model?: string;
};
