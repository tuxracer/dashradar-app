import { afterEach, describe, expect, it } from "vitest";
import {
  CRASH_RELAUNCH_WINDOW_MS,
  clearSentinel,
  readPreviousSessionEnd,
  SENTINEL_STORAGE_KEY,
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
      backend: "webgpu",
      graphCapture: true,
    });
    const result = readPreviousSessionEnd(1_500 + CRASH_RELAUNCH_WINDOW_MS);
    expect(result).toEqual({
      outcome: "crash",
      gapMs: CRASH_RELAUNCH_WINDOW_MS,
      uptimeMs: 500,
      framesProcessed: 3,
      backend: "webgpu",
      graphCapture: true,
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
      backend: undefined,
      graphCapture: undefined,
    });
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
        backend: "quantum",
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

describe("clearSentinel", () => {
  it("removes a previously written record", () => {
    writeHeartbeat({ startedAt: 0, lastBeatAt: 0, framesProcessed: 0 });
    clearSentinel();
    expect(window.localStorage.getItem(SENTINEL_STORAGE_KEY)).toBeNull();
    expect(readPreviousSessionEnd()).toBeUndefined();
  });
});
