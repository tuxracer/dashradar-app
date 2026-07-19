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
});
