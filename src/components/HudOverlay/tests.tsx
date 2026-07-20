import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HudOverlay } from "@/components/HudOverlay";
import type { HudModel } from "@/lib/detection";
import type { Detection } from "@/types";

/** No-op motion delta for tests that don't exercise gyro compensation. */
const noMotionDelta = () => ({ yaw: 0, pitch: 0 });

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
    render(
      <HudOverlay
        hud={hud}
        videoSize={size}
        viewportSize={size}
        getMotionDelta={noMotionDelta}
        stabilize={false}
      />,
    );
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
    render(
      <HudOverlay
        hud={hud}
        videoSize={size}
        viewportSize={size}
        getMotionDelta={noMotionDelta}
        stabilize={false}
      />,
    );
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
    render(
      <HudOverlay
        hud={hud}
        videoSize={size}
        viewportSize={size}
        getMotionDelta={noMotionDelta}
        stabilize={false}
      />,
    );
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
      <HudOverlay
        hud={hud}
        videoSize={size}
        viewportSize={size}
        getMotionDelta={noMotionDelta}
        stabilize={false}
      />,
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
    render(
      <HudOverlay
        hud={hud}
        videoSize={size}
        viewportSize={size}
        getMotionDelta={noMotionDelta}
        stabilize={false}
        debug
      />,
    );
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
    render(
      <HudOverlay
        hud={hud}
        videoSize={size}
        viewportSize={size}
        getMotionDelta={noMotionDelta}
        stabilize={false}
        debug
      />,
    );
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
    render(
      <HudOverlay
        hud={hud}
        videoSize={size}
        viewportSize={size}
        getMotionDelta={noMotionDelta}
        stabilize={false}
      />,
    );
    expect(screen.queryByText("92%")).not.toBeInTheDocument();
  });
});

const emptyHud: HudModel = {
  nearest: undefined,
  near: false,
  others: [],
  blips: [],
};

describe("HudOverlay motion compensation", () => {
  afterEach(() => vi.restoreAllMocks());

  // One-shot rAF: run the tick exactly once. The tick re-schedules itself, so a
  // mock that always calls cb would recurse infinitely.
  const runOneFrame = () => {
    let ran = false;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      if (!ran) {
        ran = true;
        cb(0);
      }
      return 0;
    });
  };

  it("translates the overlay container by the pixel offset for the motion delta", () => {
    runOneFrame();
    const { getByTestId } = render(
      <HudOverlay
        hud={emptyHud}
        videoSize={{ width: 1280, height: 720 }}
        viewportSize={{ width: 800, height: 600 }}
        getMotionDelta={() => ({ yaw: 0.1, pitch: 0 })}
        stabilize={true}
      />,
    );
    const container = getByTestId("hud-overlay");
    // A positive yaw shifts content left, so translateX is negative.
    expect(container.style.transform).toMatch(/translate\(-\d/);
  });

  it("leaves the transform at zero when there is no motion delta", () => {
    runOneFrame();
    const { getByTestId } = render(
      <HudOverlay
        hud={emptyHud}
        videoSize={{ width: 1280, height: 720 }}
        viewportSize={{ width: 800, height: 600 }}
        getMotionDelta={() => ({ yaw: 0, pitch: 0 })}
        stabilize={true}
      />,
    );
    expect(getByTestId("hud-overlay").style.transform).toBe(
      "translate(0px, 0px)",
    );
  });

  it("does not apply the offset when stabilization is disabled", () => {
    runOneFrame();
    const { getByTestId } = render(
      <HudOverlay
        hud={emptyHud}
        videoSize={{ width: 1280, height: 720 }}
        viewportSize={{ width: 800, height: 600 }}
        getMotionDelta={() => ({ yaw: 0.1, pitch: 0 })}
        stabilize={false}
      />,
    );
    // A nonzero delta would translate the overlay, but with stabilization off
    // the transform is held at zero.
    expect(getByTestId("hud-overlay").style.transform).toBe(
      "translate(0px, 0px)",
    );
  });
});
