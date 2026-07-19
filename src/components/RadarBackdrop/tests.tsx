import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RadarBackdrop } from "@/components/RadarBackdrop";

describe("RadarBackdrop", () => {
  it("renders a full-bleed, non-interactive backdrop element", () => {
    const { container } = render(<RadarBackdrop />);
    const el = container.firstElementChild;
    expect(el).not.toBeNull();
    expect(el).toHaveClass("pointer-events-none");
    expect(el).toHaveClass("inset-0");
  });

  // jsdom cannot compute paint order, so we assert the mechanism instead: the
  // backdrop is an opaque positioned element and must carry a negative z-index
  // so it renders behind the in-flow camera video. Without it the backdrop
  // paints on top and the feed is never visible (regression guard).
  it("sits behind the camera feed via a negative z-index", () => {
    const { container } = render(<RadarBackdrop />);
    expect(container.firstElementChild).toHaveClass("-z-10");
  });
});
