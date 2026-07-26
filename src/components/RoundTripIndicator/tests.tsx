import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RoundTripIndicator } from "@/components/RoundTripIndicator";
import type { DebugSnapshot } from "@/context/DetectionContext";

/** Snapshot with quiet defaults; override the fields a test cares about. */
const snapshot = (roundTripMs: number): DebugSnapshot => ({
  captureMs: 0,
  preprocessMs: 0,
  inferenceMs: 0,
  decodeMs: 0,
  roundTripMs,
  rawCount: 0,
  filteredCount: 0,
  shownCount: 0,
  brightFraction: 0,
  overheadMs: 0,
  pacingDelayMs: 0,
  pacingRule: "floor",
  zoom: 1,
  zoomLocked: false,
});

describe("RoundTripIndicator", () => {
  it("shows the last scan's round trip rounded to whole milliseconds", async () => {
    render(<RoundTripIndicator getDebug={() => snapshot(412.6)} />);
    await waitFor(() =>
      expect(screen.getByText("RT · 413 MS")).toBeInTheDocument(),
    );
  });

  it("shows a placeholder until the first scan lands", () => {
    // A zero snapshot means no result has come back yet, not a zero-cost scan.
    render(<RoundTripIndicator getDebug={() => snapshot(0)} />);
    expect(screen.getByText("RT · -- MS")).toBeInTheDocument();
  });

  it("follows the snapshot as later scans land", async () => {
    let current = snapshot(400);
    render(<RoundTripIndicator getDebug={() => current} />);
    await waitFor(() =>
      expect(screen.getByText("RT · 400 MS")).toBeInTheDocument(),
    );

    current = snapshot(950);
    await waitFor(() =>
      expect(screen.getByText("RT · 950 MS")).toBeInTheDocument(),
    );
  });
});
