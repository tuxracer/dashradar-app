import { CRASH_RELAUNCH_WINDOW_MS, SENTINEL_STORAGE_KEY } from "./consts";
import { isSentinelRecord } from "./types";
import type { PreviousSessionEnd, SentinelRecord } from "./types";

export * from "./consts";
export * from "./types";

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
    backend: parsed.backend,
    graphCapture: parsed.graphCapture,
    release: parsed.release,
  };
};
