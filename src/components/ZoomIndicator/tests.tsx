import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ZoomIndicator } from "@/components/ZoomIndicator";
import { ZOOM_2X, ZOOM_OFF } from "@/workers/detection/consts";

describe("ZoomIndicator", () => {
  it("renders nothing in the plain 1x mode", () => {
    const { container } = render(<ZoomIndicator mode="1x" level={ZOOM_OFF} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a constant 2X in the fixed 2x mode", () => {
    render(<ZoomIndicator mode="2x" level={ZOOM_OFF} />);
    expect(screen.getByText("2X")).toBeInTheDocument();
  });

  it("shows the live level while in auto mode", () => {
    const { rerender } = render(<ZoomIndicator mode="auto" level={ZOOM_OFF} />);
    expect(screen.getByText("AUTO · 1X")).toBeInTheDocument();

    rerender(<ZoomIndicator mode="auto" level={ZOOM_2X} />);
    expect(screen.getByText("AUTO · 2X")).toBeInTheDocument();
  });
});
