import { afterEach, describe, expect, it } from "vitest";
import {
  CRASH_RELAUNCH_WINDOW_MS,
  clearSentinel,
  heartbeatDelayMs,
  readPreviousSessionEnd,
  SENTINEL_STORAGE_KEY,
  STARTUP_HEARTBEAT_WINDOW_MS,
  uptimeBucket,
  UPTIME_BUCKET_OVERFLOW,
  UPTIME_BUCKETS,
  writeHeartbeat,
} from "@/lib/crashSentinel";

afterEach(() => {
  window.localStorage.clear();
});

// Driven off UPTIME_BUCKETS rather than a list of labels typed in here, so
// these keep testing the partitioning after someone retunes the boundaries.
describe("uptimeBucket", () => {
  it("puts a value exactly on a boundary in the bucket above it", () => {
    for (const { under } of UPTIME_BUCKETS) {
      expect(uptimeBucket(under)).not.toBe(uptimeBucket(under - 1));
      expect(uptimeBucket(under)).toBe(uptimeBucket(under + 1));
    }
  });

  it("labels every session, including zero and absurdly long ones", () => {
    const last = UPTIME_BUCKETS[UPTIME_BUCKETS.length - 1];
    expect(uptimeBucket(0)).toBe(UPTIME_BUCKETS[0].label);
    expect(uptimeBucket(last.under)).toBe(UPTIME_BUCKET_OVERFLOW);
    expect(uptimeBucket(Number.MAX_SAFE_INTEGER)).toBe(UPTIME_BUCKET_OVERFLOW);
  });

  it("never puts a longer session in an earlier bucket", () => {
    const labels = UPTIME_BUCKETS.flatMap(({ under }) => [
      uptimeBucket(under - 1),
      uptimeBucket(under),
    ]);
    // One label per bucket, plus the overflow the last boundary spills into.
    expect(new Set(labels).size).toBe(UPTIME_BUCKETS.length + 1);
  });
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

  it("carries the view, the model, and the scan count through to the report", () => {
    writeHeartbeat({
      startedAt: 0,
      lastBeatAt: 100,
      framesProcessed: 5,
      scansProcessed: 2,
      activeView: "scene",
      model: "custom",
    });
    expect(readPreviousSessionEnd(100)).toMatchObject({
      framesProcessed: 5,
      scansProcessed: 2,
      activeView: "scene",
      model: "custom",
    });
  });

  it("carries the session log through in the order it was written", () => {
    writeHeartbeat({
      startedAt: 0,
      lastBeatAt: 100,
      framesProcessed: 1,
      events: [
        { at: 10, kind: "load" },
        { at: 40, kind: "scan", detail: "420ms" },
        { at: 90, kind: "view", detail: "scene" },
      ],
    });
    expect(readPreviousSessionEnd(100)?.events).toEqual([
      { at: 10, kind: "load" },
      { at: 40, kind: "scan", detail: "420ms" },
      { at: 90, kind: "view", detail: "scene" },
    ]);
  });

  it("rejects a log carrying a kind this build does not know", () => {
    window.localStorage.setItem(
      SENTINEL_STORAGE_KEY,
      JSON.stringify({
        startedAt: 0,
        lastBeatAt: 0,
        framesProcessed: 0,
        events: [{ at: 1, kind: "telepathy" }],
      }),
    );
    expect(readPreviousSessionEnd()).toBeUndefined();
  });

  // The view becomes a tag, so a value that is not one of the three would
  // otherwise be reported as though the app had recorded it.
  it("rejects the whole record when the stored view is not a real view", () => {
    window.localStorage.setItem(
      SENTINEL_STORAGE_KEY,
      JSON.stringify({
        startedAt: 0,
        lastBeatAt: 0,
        framesProcessed: 0,
        activeView: "hologram",
      }),
    );
    expect(readPreviousSessionEnd()).toBeUndefined();
    expect(window.localStorage.getItem(SENTINEL_STORAGE_KEY)).toBeNull();
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
