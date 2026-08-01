import { afterEach, describe, expect, it } from "vitest";
import {
  CRASH_RELAUNCH_WINDOW_MS,
  clearSentinel,
  heartbeatDelayMs,
  readPreviousSessionEnd,
  SENTINEL_STORAGE_KEY,
  STARTUP_HEARTBEAT_WINDOW_MS,
  writeHeartbeat,
} from "@/lib/crashSentinel";

afterEach(() => {
  window.localStorage.clear();
});

describe("writeHeartbeat / readPreviousSessionEnd", () => {
  it("round-trips a written heartbeat record, including optional fields", () => {
    writeHeartbeat({
      startedAt: 1_000,
      lastBeatAt: 1_500,
      framesProcessed: 3,
      graphCapture: true,
      release: "dashradar@1.2.3+abc1234",
    });
    const result = readPreviousSessionEnd(1_500 + CRASH_RELAUNCH_WINDOW_MS);
    expect(result).toEqual({
      outcome: "crash",
      gapMs: CRASH_RELAUNCH_WINDOW_MS,
      uptimeMs: 500,
      framesProcessed: 3,
      graphCapture: true,
      release: "dashradar@1.2.3+abc1234",
    });
  });

  it("survives a round trip when the optional fields are absent", () => {
    writeHeartbeat({ startedAt: 0, lastBeatAt: 100, framesProcessed: 0 });
    const result = readPreviousSessionEnd(100);
    expect(result).toEqual({
      outcome: "crash",
      gapMs: 0,
      uptimeMs: 100,
      framesProcessed: 0,
      graphCapture: undefined,
      release: undefined,
    });
  });

  it("returns undefined and clears the key when the release has the wrong type", () => {
    window.localStorage.setItem(
      SENTINEL_STORAGE_KEY,
      JSON.stringify({
        startedAt: 0,
        lastBeatAt: 0,
        framesProcessed: 0,
        release: 7,
      }),
    );
    expect(readPreviousSessionEnd()).toBeUndefined();
    expect(window.localStorage.getItem(SENTINEL_STORAGE_KEY)).toBeNull();
  });

  it("removes the stored record once it has been read", () => {
    writeHeartbeat({ startedAt: 0, lastBeatAt: 0, framesProcessed: 0 });
    readPreviousSessionEnd(0);
    expect(window.localStorage.getItem(SENTINEL_STORAGE_KEY)).toBeNull();
    // A second read finds nothing: a consumed record is never reported twice.
    expect(readPreviousSessionEnd(0)).toBeUndefined();
  });

  it("returns undefined when nothing is stored", () => {
    expect(readPreviousSessionEnd()).toBeUndefined();
  });

  it("returns undefined and clears the key for invalid JSON", () => {
    window.localStorage.setItem(SENTINEL_STORAGE_KEY, "not json{");
    expect(readPreviousSessionEnd()).toBeUndefined();
    expect(window.localStorage.getItem(SENTINEL_STORAGE_KEY)).toBeNull();
  });

  it("returns undefined and clears the key for a wrong-shape blob", () => {
    window.localStorage.setItem(
      SENTINEL_STORAGE_KEY,
      JSON.stringify({ foo: "bar" }),
    );
    expect(readPreviousSessionEnd()).toBeUndefined();
    expect(window.localStorage.getItem(SENTINEL_STORAGE_KEY)).toBeNull();
  });

  it("returns undefined and clears the key when an optional field has the wrong type", () => {
    window.localStorage.setItem(
      SENTINEL_STORAGE_KEY,
      JSON.stringify({
        startedAt: 0,
        lastBeatAt: 0,
        framesProcessed: 0,
        graphCapture: "yes",
      }),
    );
    expect(readPreviousSessionEnd()).toBeUndefined();
    expect(window.localStorage.getItem(SENTINEL_STORAGE_KEY)).toBeNull();
  });

  it("classifies a gap at exactly the crash window as a crash", () => {
    writeHeartbeat({ startedAt: 0, lastBeatAt: 0, framesProcessed: 0 });
    const result = readPreviousSessionEnd(CRASH_RELAUNCH_WINDOW_MS);
    expect(result?.outcome).toBe("crash");
  });

  it("classifies a gap just past the crash window as unclean", () => {
    writeHeartbeat({ startedAt: 0, lastBeatAt: 0, framesProcessed: 0 });
    const result = readPreviousSessionEnd(CRASH_RELAUNCH_WINDOW_MS + 1);
    expect(result?.outcome).toBe("unclean");
  });
});

describe("heartbeatDelayMs", () => {
  it("beats faster inside the startup window than after it", () => {
    expect(heartbeatDelayMs(0)).toBeLessThan(
      heartbeatDelayMs(STARTUP_HEARTBEAT_WINDOW_MS),
    );
  });

  it("keeps the fast cadence up to the last moment of the window", () => {
    expect(heartbeatDelayMs(STARTUP_HEARTBEAT_WINDOW_MS - 1)).toBe(
      heartbeatDelayMs(0),
    );
  });

  it("holds the steady cadence indefinitely once the window has passed", () => {
    const settled = heartbeatDelayMs(STARTUP_HEARTBEAT_WINDOW_MS);
    expect(heartbeatDelayMs(STARTUP_HEARTBEAT_WINDOW_MS * 100)).toBe(settled);
  });

  it("resolves uptime finely enough to separate crashes inside the window", () => {
    // The crashes this cadence exists to explain all landed under ~21 s, where
    // the steady cadence recorded only 0 / 5001 / 10002. Every beat in the
    // window must be short enough to tell one second of startup from the next.
    expect(heartbeatDelayMs(0)).toBeLessThanOrEqual(1_000);
  });
});

describe("clearSentinel", () => {
  it("removes a previously written record", () => {
    writeHeartbeat({ startedAt: 0, lastBeatAt: 0, framesProcessed: 0 });
    clearSentinel();
    expect(window.localStorage.getItem(SENTINEL_STORAGE_KEY)).toBeNull();
    expect(readPreviousSessionEnd()).toBeUndefined();
  });
});
