import { isArray, isBoolean, isNumber, isPlainObject, isString } from "remeda";

/**
 * Which view was on screen when a session ended. The three cost very different
 * things to run, so a crash under only one of them is a different bug, and
 * nothing after the fact can tell them apart.
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
 * One thing the engine did, in a short rolling log so a report can say what was
 * happening before the page died rather than only how long it lived. "Died at
 * 8.0 s" and "died 340 ms after switching to the scene" are different bugs.
 */
export type SessionEvent = {
  /** Epoch ms; performance.now() restarts per page load and cannot be compared. */
  at: number;
  kind: SessionEventKind;
  /**
   * A short bounded value for the kinds that have one. Never a URL, a message,
   * or anything anyone typed: this travels off the device.
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
 * Snapshot of an in-progress session, beaten into storage so the next launch can
 * tell whether this one ended cleanly. Timestamps are epoch ms, since
 * performance.now() cannot be compared across launches. `release` is the build
 * that wrote the record, so a crash lands on the deploy that produced it.
 */
export type SentinelRecord = {
  startedAt: number;
  lastBeatAt: number;
  /**
   * Round trips the pump completed, gate skips included. Keeps that meaning
   * rather than narrowing to real scans, because reports already in hand were
   * written under it and a field that quietly changes what it counts makes every
   * comparison across the change wrong without looking wrong.
   */
  framesProcessed: number;
  /**
   * How many of those ran the model; the difference is what the gate answered for
   * free. Absent on records from builds that counted only the total.
   */
  scansProcessed?: number;
  graphCapture?: boolean;
  release?: string;
  activeView?: ActiveView;
  /** The running model: a built-in by its slug, anything added as "custom". */
  model?: string;
  /** Worker recycles this page load had done, not counting the first worker. */
  recycles?: number;
  /**
   * Age of the running worker session. A kill landing either side of a recycle
   * boundary points at the teardown and rebuild rather than steady-state scanning.
   */
  workerAgeMs?: number;
  /**
   * ImageBitmaps the page still owned, which rests at 0 or at 1 while a contact
   * is on screen. Anything climbing past that is a per-frame leak, the shape an
   * out-of-memory kill arrives in over an hours-long session.
   */
  ownedBitmaps?: number;
  /**
   * The worker's wasm heap at its last reply, the prime suspect for an iOS memory
   * kill. Such a kill runs no JS, so the size at death survives only by having
   * been written down first.
   */
  wasmHeapBytes?: number;
  /**
   * The rolling log, oldest first. Rewritten whole on every beat, so the cap is
   * the only thing between this and a record that grows for a whole drive.
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
    (value.wasmHeapBytes === undefined || isNumber(value.wasmHeapBytes)) &&
    // Strict like every other field: a log that does not parse comes from a
    // build with a different record shape, and the rest of it is no more
    // trustworthy than this part.
    (value.events === undefined ||
      (isArray(value.events) && value.events.every(isSessionEvent)))
  );
};

/**
 * How the previous session ended: "crash" when the OS killed and relaunched the
 * page almost immediately, "unclean" when the last heartbeat is older than that.
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
  wasmHeapBytes?: number;
  events?: readonly SessionEvent[];
};
