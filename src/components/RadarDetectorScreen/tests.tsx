import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CONTACT_THRESHOLD,
  RadarDetectorScreen,
} from "@/components/RadarDetectorScreen";
import type { Contact } from "@/context/DetectionContext";
import { isAudible } from "@/lib/radarAudio";
import { SEGMENT_COUNT } from "@/lib/radarSignal";

/** Spy on the beeper so tests can observe what level the rAF loop feeds it. */
const beeperUpdate = vi.fn<(level: number, nowMs: number) => void>();

vi.mock("@/lib/radarAudio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/radarAudio")>()),
  createRadarBeeper: () => ({
    update: beeperUpdate,
    dispose: () => {},
  }),
}));

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

  it("flips the status to ALERT once any signal registers", async () => {
    render(<RadarDetectorScreen confidence={0.2} audioEnabled={false} />);
    await waitFor(() =>
      expect(screen.getByTestId("signal-status")).toHaveTextContent("ALERT"),
    );
  });

  it("keeps SCANNING while the signal stays at zero", async () => {
    render(<RadarDetectorScreen confidence={0} audioEnabled={false} />);
    // Let the rAF loop tick at least once before asserting nothing changed.
    await waitFor(() =>
      expect(screen.getByTestId("signal-status")).toHaveTextContent("SCANNING"),
    );
  });

  it("feeds the beeper the raw signal while audio is enabled", async () => {
    beeperUpdate.mockClear();
    render(<RadarDetectorScreen confidence={0.8} audioEnabled={true} />);
    await waitFor(() =>
      expect(beeperUpdate).toHaveBeenCalledWith(0.8, expect.any(Number)),
    );
  });

  it("silences the beeper the moment the signal drops, ahead of the dial's decay", async () => {
    beeperUpdate.mockClear();
    const view = render(
      <RadarDetectorScreen confidence={0.8} audioEnabled={true} />,
    );
    await waitFor(() =>
      expect(beeperUpdate).toHaveBeenCalledWith(0.8, expect.any(Number)),
    );

    // The detection disappears. The dial's peak-hold keeps the readout well
    // above zero for seconds, but the audio must go silent immediately.
    view.rerender(<RadarDetectorScreen confidence={0} audioEnabled={true} />);
    beeperUpdate.mockClear();
    await waitFor(() => expect(beeperUpdate).toHaveBeenCalled());
    expect(beeperUpdate).toHaveBeenLastCalledWith(0, expect.any(Number));
    // The decaying meter is still nonzero: the readout has not fallen to 0%.
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("feeds the beeper silence when audio is disabled", async () => {
    beeperUpdate.mockClear();
    render(<RadarDetectorScreen confidence={0.8} audioEnabled={false} />);
    await waitFor(() => expect(beeperUpdate).toHaveBeenCalled());
    expect(beeperUpdate).toHaveBeenLastCalledWith(0, expect.any(Number));
  });

  it("never beeps at a signal the dial does not indicate", () => {
    // The dial and the beeper are fed the same raw signal, and the peak-held
    // dial level is always at least that raw value. So as long as the audio
    // floor sits at or above the dial's contact threshold, an audible beep
    // implies the dial is already showing ALERT. Guards against retuning
    // AUDIO_FLOOR below CONTACT_THRESHOLD, which would let the beeper sound
    // while the meter still reads SCANNING.
    expect(isAudible(CONTACT_THRESHOLD)).toBe(false);
    expect(isAudible(CONTACT_THRESHOLD / 2)).toBe(false);
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
  it("renders the card with the direction from the contact", () => {
    render(
      <RadarDetectorScreen
        confidence={0.5}
        audioEnabled={false}
        contact={testContact("left")}
      />,
    );
    expect(screen.getByTestId("contact-card")).toBeInTheDocument();
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
