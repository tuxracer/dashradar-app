import { isBoolean, isNumber, isPlainObject } from "remeda";
import type { DetectionBackend } from "@/workers/detection/types";
import { isDetectionBackend } from "@/workers/detection/types";

/**
 * Snapshot of an in-progress detection session, written to localStorage on a
 * heartbeat cadence while scanning runs so the next launch can tell whether
 * this one ended cleanly. `startedAt`/`lastBeatAt` are `Date.now()` epoch ms
 * (never `performance.now()`, which resets every page load and so cannot be
 * compared across launches). `backend`/`graphCapture` are absent until the
 * worker has reported them.
 */
export type SentinelRecord = {
  startedAt: number;
  lastBeatAt: number;
  framesProcessed: number;
  backend?: DetectionBackend;
  graphCapture?: boolean;
};

/** Validates a value parsed from localStorage before it is trusted as a SentinelRecord. */
export const isSentinelRecord = (value: unknown): value is SentinelRecord => {
  return (
    isPlainObject(value) &&
    isNumber(value.startedAt) &&
    isNumber(value.lastBeatAt) &&
    isNumber(value.framesProcessed) &&
    (value.backend === undefined || isDetectionBackend(value.backend)) &&
    (value.graphCapture === undefined || isBoolean(value.graphCapture))
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
  backend?: DetectionBackend;
  graphCapture?: boolean;
};
