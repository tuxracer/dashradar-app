import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RadarStrip } from "@/components/RadarStrip";

describe("RadarStrip", () => {
  it("positions one blip per detection by fraction", () => {
    const { container } = render(
      <RadarStrip
        blips={[
          { x: 0.2, near: false },
          { x: 0.5, near: true },
        ]}
      />,
    );
    const blips = container.querySelectorAll("[data-testid=blip]");
    expect(blips).toHaveLength(2);
    expect((blips[0] as HTMLElement).style.left).toBe("20%");
    expect((blips[1] as HTMLElement).style.left).toBe("50%");
  });

  it("styles the near blip amber", () => {
    const { container } = render(
      <RadarStrip blips={[{ x: 0.5, near: true }]} />,
    );
    const blip = container.querySelector("[data-testid=blip]");
    expect(blip?.className).toContain("bg-hud-amber");
  });
});
