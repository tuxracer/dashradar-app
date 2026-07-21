import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RadarDetectorScreen } from "@/components/RadarDetectorScreen";
import type { Contact } from "@/context/DetectionContext";
import { SEGMENT_COUNT } from "@/lib/radarSignal";

describe("RadarDetectorScreen", () => {
  it("renders the POLICE SIGNAL label", () => {
    render(<RadarDetectorScreen confidence={0.5} audioEnabled={false} />);
    expect(screen.getByText("POLICE SIGNAL")).toBeInTheDocument();
  });

  it("renders one node per ladder segment", () => {
    render(<RadarDetectorScreen confidence={0.5} audioEnabled={false} />);
    expect(screen.getAllByTestId("signal-segment")).toHaveLength(SEGMENT_COUNT);
  });

  it("starts idle: zero readout and a SCANNING status", () => {
    render(<RadarDetectorScreen confidence={0} audioEnabled={false} />);
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.getByTestId("signal-status")).toHaveTextContent("SCANNING");
  });
});

/** Test contact; the bitmap is a cast fake because jsdom has no ImageBitmap
 * and the component only reads width/height and draws it (draw is skipped
 * when jsdom's canvas has no 2d context). */
const testContact = (direction: Contact["direction"]): Contact => ({
  image: { width: 320, height: 240, close: () => {} } as unknown as ImageBitmap,
  score: 0.85,
  signal: 0.5,
  box: { xmin: 0.1, ymin: 0.4, xmax: 0.3, ymax: 0.6 },
  direction,
  at: 0,
});

describe("RadarDetectorScreen contact card", () => {
  it("renders the card with percent and direction from the contact", () => {
    render(
      <RadarDetectorScreen
        confidence={0.5}
        audioEnabled={false}
        contact={testContact("left")}
      />,
    );
    expect(screen.getByTestId("contact-card")).toBeInTheDocument();
    expect(screen.getByText("CONTACT")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByTestId("contact-direction")).toHaveTextContent("LEFT");
  });

  it("renders direction copy for ahead contacts", () => {
    render(
      <RadarDetectorScreen
        confidence={0.5}
        audioEnabled={false}
        contact={testContact("ahead")}
      />,
    );
    expect(screen.getByTestId("contact-direction")).toHaveTextContent("AHEAD");
  });

  it("renders no card without a contact", () => {
    render(<RadarDetectorScreen confidence={0.5} audioEnabled={false} />);
    expect(screen.queryByTestId("contact-card")).not.toBeInTheDocument();
  });

  it("starts with the card hidden until the rAF loop lights it", () => {
    render(
      <RadarDetectorScreen
        confidence={0}
        audioEnabled={false}
        contact={testContact("left")}
      />,
    );
    // Visibility is CSS-driven from the root's data-contact attribute, which
    // the rAF loop owns; before a tick it must read false.
    expect(
      screen.getByTestId("contact-card").closest("[data-contact]"),
    ).toHaveAttribute("data-contact", "false");
  });
});
