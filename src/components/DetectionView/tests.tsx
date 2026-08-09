import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DetectionView } from "@/components/DetectionView";
import type { Track } from "@/lib/detectionTracker";
import type { IdentifiedDetection } from "@/types";
import { ZOOM_2X, ZOOM_OFF } from "@/workers/detection/consts";

let minted = 0;
/** Unique id per call, the way the tracker guarantees them within a frame. */
const detection = (
  overrides: Partial<IdentifiedDetection> = {},
): IdentifiedDetection => ({
  id: `det-${(minted += 1)}`,
  color: "rgb(0, 255, 0)",
  label: "police",
  score: 0.87,
  box: { xmin: 0.4, ymin: 0.5, xmax: 0.6, ymax: 0.8 },
  ...overrides,
});

/** A track built like a detection, still until a velocity is given. */
const track = (overrides: Partial<Track> = {}): Track => ({
  ...detection(),
  lastSeenAt: 0,
  velocity: { centerX: 0, centerY: 0, width: 0, height: 0 },
  ...overrides,
});

/** A frame and viewport of the same size, so boxes map 1:1 to pixels. */
const square = { width: 1000, height: 1000 };

describe("DetectionView", () => {
  it("draws one box per detection", () => {
    render(
      <DetectionView
        detections={[
          detection(),
          detection({ box: { xmin: 0.1, ymin: 0.1, xmax: 0.2, ymax: 0.2 } }),
        ]}
        tracks={[]}
        at={0}
        frame={square}
        viewport={square}
        zoom={ZOOM_OFF}
      />,
    );
    expect(screen.getAllByTestId("detection-box")).toHaveLength(2);
  });

  it("places a box where the frame maps it in the viewport", () => {
    render(
      <DetectionView
        detections={[detection()]}
        tracks={[]}
        at={0}
        frame={square}
        viewport={square}
        zoom={ZOOM_OFF}
      />,
    );
    const drawn = screen.getByTestId("detection-box");
    expect(drawn.style.left).toBe("400px");
    expect(drawn.style.top).toBe("500px");
    expect(drawn.style.width).toBe("200px");
    expect(drawn.style.height).toBe("300px");
  });

  it("outlines the whole frame as the scan region at 1x on a square frame", () => {
    render(
      <DetectionView
        detections={[]}
        tracks={[]}
        at={0}
        frame={square}
        viewport={square}
        zoom={ZOOM_OFF}
      />,
    );
    const region = screen.getByTestId("scan-region");
    expect(region.style.left).toBe("0px");
    expect(region.style.width).toBe("1000px");
  });

  it("shrinks the scan region outline at 2x", () => {
    render(
      <DetectionView
        detections={[]}
        tracks={[]}
        at={0}
        frame={square}
        viewport={square}
        zoom={ZOOM_2X}
      />,
    );
    const region = screen.getByTestId("scan-region");
    expect(region.style.left).toBe("250px");
    expect(region.style.width).toBe("500px");
  });

  it("renders nothing but the region outline on a scan with no detections", () => {
    render(
      <DetectionView
        detections={[]}
        tracks={[]}
        at={0}
        frame={square}
        viewport={square}
        zoom={ZOOM_OFF}
      />,
    );
    expect(screen.queryByTestId("detection-box")).toBeNull();
    expect(screen.getByTestId("scan-region")).toBeInTheDocument();
  });

  it("draws each box and its label in the detection's own color", () => {
    render(
      <DetectionView
        detections={[
          detection({ color: "rgb(255, 0, 0)" }),
          detection({
            color: "rgb(0, 0, 255)",
            box: { xmin: 0.1, ymin: 0.1, xmax: 0.2, ymax: 0.2 },
          }),
        ]}
        tracks={[]}
        at={0}
        frame={square}
        viewport={square}
        zoom={ZOOM_OFF}
      />,
    );
    const [first, second] = screen.getAllByTestId("detection-box");
    expect(first.style.borderColor).toBe("rgb(255, 0, 0)");
    expect(second.style.borderColor).toBe("rgb(0, 0, 255)");
    // The label chip follows its box, so the pair reads as one object.
    expect(first.querySelector("span")?.style.color).toBe("rgb(255, 0, 0)");
  });

  it("shows the raw class beside the normalized one only where a fold happened", () => {
    render(
      <DetectionView
        detections={[
          detection({ label: "vehicle", rawLabel: "truck" }),
          detection({
            label: "police",
            box: { xmin: 0.1, ymin: 0.1, xmax: 0.2, ymax: 0.2 },
          }),
        ]}
        tracks={[]}
        at={0}
        frame={square}
        viewport={square}
        zoom={ZOOM_OFF}
      />,
    );
    const [folded, direct] = screen.getAllByTestId("detection-box");
    expect(folded.textContent).toContain("vehicle (truck)");
    expect(direct.textContent).toContain("police");
    expect(direct.textContent).not.toContain("(");
  });

  it("gives two boxes clamped to the same corner distinct keys", () => {
    // Two boxes of one class both clamped to the top-left edge produced an
    // identical key under `label:xmin:ymin`. React still renders both, so the
    // only observable symptom is the duplicate-key warning.
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <DetectionView
        detections={[
          detection({ box: { xmin: 0, ymin: 0, xmax: 0.3, ymax: 0.3 } }),
          detection({ box: { xmin: 0, ymin: 0, xmax: 0.5, ymax: 0.5 } }),
        ]}
        tracks={[]}
        at={0}
        frame={square}
        viewport={square}
        zoom={ZOOM_OFF}
      />,
    );
    expect(screen.getAllByTestId("detection-box")).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("draws a coasting track as a ghost at its velocity-extrapolated box", () => {
    // Seen 2 s before the scan, drifting right at 0.0001 frame-widths/ms, so
    // the ghost lands 0.2 of the frame (200 px) right of where it was seen.
    render(
      <DetectionView
        detections={[]}
        tracks={[
          track({
            lastSeenAt: 1_000,
            velocity: { centerX: 0.0001, centerY: 0, width: 0, height: 0 },
          }),
        ]}
        at={3_000}
        frame={square}
        viewport={square}
        zoom={ZOOM_OFF}
      />,
    );
    const ghost = screen.getByTestId("predicted-box");
    expect(ghost.style.left).toBe("600px");
    expect(ghost.style.top).toBe("500px");
    expect(ghost.style.width).toBe("200px");
    expect(ghost.style.height).toBe("300px");
  });

  it("labels a ghost with its color and how long it has been unseen", () => {
    render(
      <DetectionView
        detections={[]}
        tracks={[track({ color: "rgb(255, 0, 255)", lastSeenAt: 500 })]}
        at={3_000}
        frame={square}
        viewport={square}
        zoom={ZOOM_OFF}
      />,
    );
    const ghost = screen.getByTestId("predicted-box");
    expect(ghost.style.borderColor).toBe("rgb(255, 0, 255)");
    expect(ghost.textContent).toContain("2.5s ago");
  });

  it("draws no ghost for a track the scan matched", () => {
    // A just-matched track's prediction collapses onto the detection's own
    // box, so a ghost there would only double the solid border.
    const at = 3_000;
    render(
      <DetectionView
        detections={[detection()]}
        tracks={[track({ lastSeenAt: at })]}
        at={at}
        frame={square}
        viewport={square}
        zoom={ZOOM_OFF}
      />,
    );
    expect(screen.queryByTestId("predicted-box")).toBeNull();
    expect(screen.getByTestId("detection-box")).toBeInTheDocument();
  });
});
