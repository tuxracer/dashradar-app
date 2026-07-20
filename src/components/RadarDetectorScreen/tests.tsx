import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RadarDetectorScreen } from "@/components/RadarDetectorScreen";
import { SEGMENT_COUNT } from "@/lib/radarSignal";

describe("RadarDetectorScreen", () => {
  it("renders the POLICE SIGNAL label", () => {
    render(<RadarDetectorScreen confidence={0.5} />);
    expect(screen.getByText("POLICE SIGNAL")).toBeInTheDocument();
  });

  it("renders one node per ladder segment", () => {
    render(<RadarDetectorScreen confidence={0.5} />);
    expect(screen.getAllByTestId("signal-segment")).toHaveLength(SEGMENT_COUNT);
  });

  it("starts idle: zero readout and a SCANNING status", () => {
    render(<RadarDetectorScreen confidence={0} />);
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.getByTestId("signal-status")).toHaveTextContent("SCANNING");
  });
});
