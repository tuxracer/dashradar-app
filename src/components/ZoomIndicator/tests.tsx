import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ZoomIndicator } from "@/components/ZoomIndicator";
import { ZOOM_2X, ZOOM_OFF } from "@/workers/detection/consts";

describe("ZoomIndicator", () => {
  it("shows a constant 1X in the plain 1x mode", () => {
    render(<ZoomIndicator mode="1x" level={ZOOM_OFF} locked={false} />);
    expect(screen.getByText("1X")).toBeInTheDocument();
  });

  it("shows a constant 2X in the fixed 2x mode", () => {
    render(<ZoomIndicator mode="2x" level={ZOOM_OFF} locked={false} />);
    expect(screen.getByText("2X")).toBeInTheDocument();
  });

  it("shows the live level while in auto mode", () => {
    const { rerender } = render(
      <ZoomIndicator mode="auto" level={ZOOM_OFF} locked={false} />,
    );
    expect(screen.getByText("AUTO · 1X")).toBeInTheDocument();

    rerender(<ZoomIndicator mode="auto" level={ZOOM_2X} locked={false} />);
    expect(screen.getByText("AUTO · 2X")).toBeInTheDocument();
  });

  it("appends the lock state while the auto zoom is holding a level", () => {
    render(<ZoomIndicator mode="auto" level={ZOOM_2X} locked={true} />);
    expect(screen.getByText("AUTO · 2X · LOCKED")).toBeInTheDocument();
  });

  it("never shows a lock in the fixed modes", () => {
    // The machine resets to unlocked outside auto mode, but the label must
    // not depend on that: a fixed mode has no lock concept at all.
    render(<ZoomIndicator mode="2x" level={ZOOM_2X} locked={true} />);
    expect(screen.getByText("2X")).toBeInTheDocument();
    expect(screen.queryByText(/LOCKED/)).not.toBeInTheDocument();
  });
});
