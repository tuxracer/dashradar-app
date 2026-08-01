import { isBoolean, isNumber, isPlainObject, isString } from "remeda";

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
  framesProcessed: number;
  graphCapture?: boolean;
  release?: string;
};

/** Validates a value parsed from localStorage before it is trusted as a SentinelRecord. */
export const isSentinelRecord = (value: unknown): value is SentinelRecord => {
  return (
    isPlainObject(value) &&
    isNumber(value.startedAt) &&
    isNumber(value.lastBeatAt) &&
    isNumber(value.framesProcessed) &&
    (value.graphCapture === undefined || isBoolean(value.graphCapture)) &&
    (value.release === undefined || isString(value.release))
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
  graphCapture?: boolean;
  release?: string;
};
