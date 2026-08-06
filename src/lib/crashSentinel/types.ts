import { isArray, isBoolean, isNumber, isPlainObject, isString } from "remeda";

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
 * What happened. A fixed set rather than free text, so the log stays bounded
 * in size and in what it can ever say about a person's device.
 */
export type SessionEventKind =
  | "scan"
  | "skip"
  | "load"
  | "recycle"
  | "view"
  | "video"
  | "error";

const SESSION_EVENT_KINDS: readonly SessionEventKind[] = [
  "scan",
  "skip",
  "load",
  "recycle",
  "view",
  "video",
  "error",
];

/**
 * One thing the engine did, kept in a short rolling log so a crash report can
 * say what was happening just before the page died rather than only how long
 * it had been alive. "Died at 8.0 s" and "died 340 ms after switching to the
 * scene view" are the same crash and different bugs.
 */
export type SessionEvent = {
  /**
   * Date.now() epoch ms, never performance.now(), which restarts every page
   * load and so cannot be read against the heartbeat at the next launch.
   */
  at: number;
  kind: SessionEventKind;
  /**
   * A short bounded value for the kinds that have one (a round trip, a view
   * name, an error code). Never a URL, a message, or anything anyone typed:
   * this travels off the device.
   */
  detail?: string;
};

/** Validates one entry of a log read back from localStorage. */
export const isSessionEvent = (value: unknown): value is SessionEvent =>
  isPlainObject(value) &&
  isNumber(value.at) &&
  isString(value.kind) &&
  SESSION_EVENT_KINDS.includes(value.kind as SessionEventKind) &&
  (value.detail === undefined || isString(value.detail));

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
  /** Worker recycles this page load had done, not counting the first worker. */
  recycles?: number;
  /**
   * Age of the worker session that was running. A kill landing just short of
   * WORKER_RECYCLE_AFTER_MS, or just after one of these wrapped around, points
   * at the teardown and rebuild rather than at steady-state scanning.
   */
  workerAgeMs?: number;
  /**
   * ImageBitmaps the page still owned. Each one has a single owner and a
   * single release, so this rests at 0 or at 1 while a contact is on screen;
   * a number climbing past that is a per-frame leak, which on a session that
   * runs for hours is the shape an out-of-memory kill arrives in.
   */
  ownedBitmaps?: number;
  /**
   * The rolling log, oldest first, capped at MAX_SESSION_EVENTS. Rewritten
   * whole on every beat, which is what bounds it: the cap is the only thing
   * between this and a record that grows for the length of a drive.
   */
  events?: readonly SessionEvent[];
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
    (value.model === undefined || isString(value.model)) &&
    (value.recycles === undefined || isNumber(value.recycles)) &&
    (value.workerAgeMs === undefined || isNumber(value.workerAgeMs)) &&
    (value.ownedBitmaps === undefined || isNumber(value.ownedBitmaps)) &&
    // Strict, like every other field here: a log that does not parse comes
    // from a build that wrote a different record shape, and the rest of that
    // record cannot be read with any more confidence than this part of it.
    (value.events === undefined ||
      (isArray(value.events) && value.events.every(isSessionEvent)))
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
  recycles?: number;
  workerAgeMs?: number;
  ownedBitmaps?: number;
  events?: readonly SessionEvent[];
};
