import { afterEach, describe, expect, it, vi } from "vitest";
import {
  medianSeconds,
  readTimingHistory,
  recordTimings,
  TIMING_ANALYTICS_STORAGE_KEY,
  TIMING_HISTORY_LIMIT,
  TIMING_HISTORY_STORAGE_KEY,
  takeTimingReport,
  toBucketedSeconds,
} from "@/lib/timingHistory";

afterEach(() => {
  // Unstub first: one test replaces sessionStorage with a throwing stub that
  // has no clear() of its own.
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("toBucketedSeconds", () => {
  it("rounds milliseconds to the nearest half second", () => {
    expect(toBucketedSeconds(1_488)).toBe(1.5);
    expect(toBucketedSeconds(1_986)).toBe(2);
    expect(toBucketedSeconds(120)).toBe(0);
    expect(toBucketedSeconds(260)).toBe(0.5);
  });
});

describe("timing history", () => {
  it("reads as empty before anything is recorded", () => {
    expect(readTimingHistory()).toEqual({ roundTrip: [], inference: [] });
  });

  it("appends a bucketed sample per scan, oldest first", () => {
    recordTimings({ roundTripMs: 1_488, inferenceMs: 240 });
    recordTimings({ roundTripMs: 1_986, inferenceMs: 760 });
    expect(readTimingHistory()).toEqual({
      roundTrip: [1.5, 2],
      inference: [0, 1],
    });
  });

  it("keeps only the last TIMING_HISTORY_LIMIT scans", () => {
    for (let scan = 0; scan <= TIMING_HISTORY_LIMIT; scan += 1) {
      recordTimings({ roundTripMs: scan * 500, inferenceMs: 500 });
    }
    const history = readTimingHistory();
    expect(history.roundTrip).toHaveLength(TIMING_HISTORY_LIMIT);
    expect(history.inference).toHaveLength(TIMING_HISTORY_LIMIT);
    // The first scan (0 s) has rolled out of the window; the last is kept.
    expect(history.roundTrip[0]).toBe(0.5);
    expect(history.roundTrip.at(-1)).toBe(TIMING_HISTORY_LIMIT / 2);
  });

  it("keeps the two series index-aligned on the same scan", () => {
    recordTimings({ roundTripMs: 2_000, inferenceMs: 1_000 });
    const { roundTrip, inference } = readTimingHistory();
    expect(roundTrip).toHaveLength(inference.length);
  });

  it("drops a non-finite reading instead of writing it", () => {
    recordTimings({ roundTripMs: 1_000, inferenceMs: 500 });
    recordTimings({ roundTripMs: Number.NaN, inferenceMs: 500 });
    expect(readTimingHistory()).toEqual({ roundTrip: [1], inference: [0.5] });
  });

  it("starts over from a corrupt stored blob", () => {
    window.sessionStorage.setItem(TIMING_HISTORY_STORAGE_KEY, "not json {");
    expect(readTimingHistory()).toEqual({ roundTrip: [], inference: [] });
    recordTimings({ roundTripMs: 1_000, inferenceMs: 500 });
    expect(readTimingHistory()).toEqual({ roundTrip: [1], inference: [0.5] });
  });

  it("starts over from a stored blob of the wrong shape", () => {
    window.sessionStorage.setItem(
      TIMING_HISTORY_STORAGE_KEY,
      JSON.stringify({ roundTrip: ["1.5"], inference: [] }),
    );
    expect(readTimingHistory()).toEqual({ roundTrip: [], inference: [] });
  });

  it("returns the updated window from a recording", () => {
    recordTimings({ roundTripMs: 1_000, inferenceMs: 500 });
    expect(recordTimings({ roundTripMs: 2_000, inferenceMs: 500 })).toEqual({
      roundTrip: [1, 2],
      inference: [0.5, 0.5],
    });
  });

  it("survives storage that throws on write", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    });
    expect(() =>
      recordTimings({ roundTripMs: 1_000, inferenceMs: 500 }),
    ).not.toThrow();
  });
});

describe("medianSeconds", () => {
  it("takes the middle sample of an odd-length series", () => {
    expect(medianSeconds([2, 0.5, 1])).toBe(1);
  });

  it("snaps an even-length series' midpoint back onto the half-second grid", () => {
    // 1.5 and 2 average to 1.75, which is not a bucket any sample can take.
    expect(medianSeconds([1, 1.5, 2, 3])).toBe(2);
  });

  it("is unmoved by an outlier at either end", () => {
    expect(medianSeconds([1, 1, 1, 1, 30])).toBe(1);
  });

  it("reads an empty series as zero", () => {
    expect(medianSeconds([])).toBe(0);
  });
});

describe("takeTimingReport", () => {
  /** Fill the window with scans whose round trip is `roundTripMs`. */
  const fillWindow = (roundTripMs = 2_000, inferenceMs = 1_000) => {
    let history = readTimingHistory();
    for (let scan = 0; scan < TIMING_HISTORY_LIMIT; scan += 1) {
      history = recordTimings({ roundTripMs, inferenceMs });
    }
    return history;
  };

  it("reports nothing until the window has filled", () => {
    let history = readTimingHistory();
    for (let scan = 0; scan < TIMING_HISTORY_LIMIT - 1; scan += 1) {
      history = recordTimings({ roundTripMs: 2_000, inferenceMs: 1_000 });
      expect(takeTimingReport(history)).toBeUndefined();
    }
  });

  it("reports both medians once the window fills", () => {
    expect(takeTimingReport(fillWindow())).toEqual({
      roundTrip: 2,
      inference: 1,
    });
  });

  it("reports only once per session, however long the drive runs", () => {
    expect(takeTimingReport(fillWindow())).toBeDefined();
    // The window keeps rolling for the rest of the drive; none of those later
    // full windows may report again.
    for (let scan = 0; scan < TIMING_HISTORY_LIMIT * 2; scan += 1) {
      const history = recordTimings({ roundTripMs: 500, inferenceMs: 500 });
      expect(takeTimingReport(history)).toBeUndefined();
    }
  });

  it("marks the session reported in sessionStorage", () => {
    takeTimingReport(fillWindow());
    expect(
      window.sessionStorage.getItem(TIMING_ANALYTICS_STORAGE_KEY),
    ).not.toBeNull();
  });

  it("stays quiet when a session was already marked reported", () => {
    window.sessionStorage.setItem(TIMING_ANALYTICS_STORAGE_KEY, "true");
    expect(takeTimingReport(fillWindow())).toBeUndefined();
  });

  it("reports nothing when storage cannot record that it did", () => {
    // Without a durable mark there is no way to stay quiet afterwards, and an
    // event per scan for the rest of the drive is worse than no event.
    const history = fillWindow();
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    });
    expect(takeTimingReport(history)).toBeUndefined();
  });
});
