import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DetectionView } from "@/components/DetectionView";
import type { Detection } from "@/types";
import { ZOOM_2X, ZOOM_OFF } from "@/workers/detection/consts";

const detection = (overrides: Partial<Detection> = {}): Detection => ({
  label: "police",
  displayLabel: "POLICE",
  category: "vehicle",
  score: 0.87,
  box: { xmin: 0.4, ymin: 0.5, xmax: 0.6, ymax: 0.8 },
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
        frame={square}
        viewport={square}
        zoom={ZOOM_OFF}
      />,
    );
    expect(screen.queryByTestId("detection-box")).toBeNull();
    expect(screen.getByTestId("scan-region")).toBeInTheDocument();
  });

  it("draws two categories in different colors", () => {
    render(
      <DetectionView
        detections={[
          detection({ category: "vehicle" }),
          detection({
            category: "person",
            box: { xmin: 0.1, ymin: 0.1, xmax: 0.2, ymax: 0.2 },
          }),
        ]}
        frame={square}
        viewport={square}
        zoom={ZOOM_OFF}
      />,
    );
    const [first, second] = screen.getAllByTestId("detection-box");
    expect(first.style.borderColor).not.toBe("");
    expect(first.style.borderColor).not.toBe(second.style.borderColor);
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
        frame={square}
        viewport={square}
        zoom={ZOOM_OFF}
      />,
    );
    expect(screen.getAllByTestId("detection-box")).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
