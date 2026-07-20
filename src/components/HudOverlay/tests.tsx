import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HudOverlay } from "@/components/HudOverlay";
import type { HudModel } from "@/lib/detection";
import type { Detection } from "@/types";

const car: Detection = {
  label: "car",
  displayLabel: "CAR",
  category: "vehicle",
  score: 0.92,
  box: { xmin: 0.4, ymin: 0.5, xmax: 0.6, ymax: 0.8 },
};

const person: Detection = {
  label: "person",
  displayLabel: "PERSON",
  category: "person",
  score: 0.84,
  box: { xmin: 0.7, ymin: 0.4, xmax: 0.8, ymax: 0.9 },
};

const size = { width: 1000, height: 500 };

describe("HudOverlay", () => {
  it("renders the nearest box with a NEAR pill when near", () => {
    const hud: HudModel = {
      nearest: car,
      near: true,
      others: [person],
      blips: [],
    };
    render(<HudOverlay hud={hud} videoSize={size} viewportSize={size} />);
    expect(screen.getByText("CAR · NEAR")).toBeInTheDocument();
    const box = screen.getByTestId("nearest-box");
    expect(box.style.left).toBe("400px");
    expect(box.style.top).toBe("250px");
    expect(box.style.width).toBe("200px");
    expect(box.style.height).toBe("150px");
  });

  it("renders the nearest label without NEAR when far", () => {
    const hud: HudModel = {
      nearest: car,
      near: false,
      others: [],
      blips: [],
    };
    render(<HudOverlay hud={hud} videoSize={size} viewportSize={size} />);
    expect(screen.getByText("CAR")).toBeInTheDocument();
    expect(screen.queryByText("CAR · NEAR")).not.toBeInTheDocument();
  });

  it("renders floating tags for the other detections", () => {
    const hud: HudModel = {
      nearest: car,
      near: true,
      others: [person],
      blips: [],
    };
    render(<HudOverlay hud={hud} videoSize={size} viewportSize={size} />);
    expect(screen.getByText("PERSON")).toBeInTheDocument();
  });

  it("renders nothing for an empty frame", () => {
    const hud: HudModel = {
      nearest: undefined,
      near: false,
      others: [],
      blips: [],
    };
    const { container } = render(
      <HudOverlay hud={hud} videoSize={size} viewportSize={size} />,
    );
    expect(container.querySelector("[data-testid=nearest-box]")).toBeNull();
  });

  it("shows confidence and coords on the nearest box when debug is on", () => {
    const hud: HudModel = {
      nearest: car,
      near: true,
      others: [],
      blips: [],
    };
    render(<HudOverlay hud={hud} videoSize={size} viewportSize={size} debug />);
    expect(screen.getByText("92%")).toBeInTheDocument();
    expect(screen.getByText("0.40,0.50 0.60,0.80")).toBeInTheDocument();
  });

  it("shows confidence and coords on floating tags when debug is on", () => {
    const hud: HudModel = {
      nearest: car,
      near: true,
      others: [person],
      blips: [],
    };
    render(<HudOverlay hud={hud} videoSize={size} viewportSize={size} debug />);
    expect(screen.getByText("84%")).toBeInTheDocument();
    expect(screen.getByText("0.70,0.40 0.80,0.90")).toBeInTheDocument();
  });

  it("omits confidence and coords when debug is off", () => {
    const hud: HudModel = {
      nearest: car,
      near: true,
      others: [],
      blips: [],
    };
    render(<HudOverlay hud={hud} videoSize={size} viewportSize={size} />);
    expect(screen.queryByText("92%")).not.toBeInTheDocument();
  });
});
