import {
  CRASH_RELAUNCH_WINDOW_MS,
  HEARTBEAT_INTERVAL_MS,
  SENTINEL_STORAGE_KEY,
  STARTUP_HEARTBEAT_INTERVAL_MS,
  STARTUP_HEARTBEAT_WINDOW_MS,
  UPTIME_BUCKET_OVERFLOW,
  UPTIME_BUCKETS,
} from "./consts";
import { isSentinelRecord } from "./types";
import type { PreviousSessionEnd, SentinelRecord } from "./types";

export * from "./consts";
export * from "./types";

/**
 * Delay until the next heartbeat, given how long the session has been scanning.
 * Beats fast through the startup window, where every crash observed so far
 * lands, and settles to the steady cadence past it so the rest of a drive costs
 * what it always did.
 */
export const heartbeatDelayMs = (uptimeMs: number): number =>
  uptimeMs < STARTUP_HEARTBEAT_WINDOW_MS
    ? STARTUP_HEARTBEAT_INTERVAL_MS
    : HEARTBEAT_INTERVAL_MS;

/**
 * The reporting label for how long a session ran, from UPTIME_BUCKETS. Buckets
 * are open at the bottom and closed at the top, so a session that ran exactly
 * as long as a boundary falls in the bucket above it, and the labels read as
 * the ranges they are with no value belonging to two of them.
 */
export const uptimeBucket = (uptimeMs: number): string =>
  UPTIME_BUCKETS.find(({ under }) => uptimeMs < under)?.label ??
  UPTIME_BUCKET_OVERFLOW;

/**
 * Writes the current heartbeat record to localStorage under
 * `SENTINEL_STORAGE_KEY`. Wrapped in try/catch so private-mode storage
 * restrictions or quota errors degrade to a no-op instead of throwing from
 * inside the frame pump.
 */
export const writeHeartbeat = (record: SentinelRecord): void => {
  try {
    window.localStorage.setItem(SENTINEL_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage unavailable (private mode / quota); the next beat tries again.
  }
};

/** Removes the sentinel record, marking the current session as ended cleanly. */
export const clearSentinel = (): void => {
  try {
    window.localStorage.removeItem(SENTINEL_STORAGE_KEY);
  } catch {
    // Storage unavailable; nothing to clear.
  }
};

/**
 * Reads and classifies the previous session's sentinel record, if any.
 * Always removes the stored key (whether the record parses, is invalid, or
 * doesn't exist) so a consumed or invalid record is never reported twice.
 * Returns undefined when nothing valid was stored. `now` defaults to
 * `Date.now()` and is a parameter only so tests can control the gap.
 */
export const readPreviousSessionEnd = (
  now = Date.now(),
): PreviousSessionEnd | undefined => {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(SENTINEL_STORAGE_KEY);
    window.localStorage.removeItem(SENTINEL_STORAGE_KEY);
  } catch {
    return undefined;
  }
  if (!raw) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isSentinelRecord(parsed)) {
    return undefined;
  }
  const gapMs = now - parsed.lastBeatAt;
  return {
    outcome: gapMs <= CRASH_RELAUNCH_WINDOW_MS ? "crash" : "unclean",
    gapMs,
    uptimeMs: parsed.lastBeatAt - parsed.startedAt,
    framesProcessed: parsed.framesProcessed,
    scansProcessed: parsed.scansProcessed,
    graphCapture: parsed.graphCapture,
    release: parsed.release,
    activeView: parsed.activeView,
    model: parsed.model,
    recycles: parsed.recycles,
    workerAgeMs: parsed.workerAgeMs,
    ownedBitmaps: parsed.ownedBitmaps,
    wasmHeapBytes: parsed.wasmHeapBytes,
    events: parsed.events,
  };
};
