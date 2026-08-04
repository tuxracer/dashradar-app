import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTACT_THRESHOLD,
  RadarDetectorScreen,
} from "@/components/RadarDetectorScreen";
import type { Contact } from "@/context/DetectionContext";
import { isAudible } from "@/lib/radarAudio";

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

  it("reads INITIALIZING before detection has started", async () => {
    render(
      <RadarDetectorScreen
        confidence={0}
        audioEnabled={false}
        initializing={true}
      />,
    );
    expect(screen.getByTestId("signal-status")).toHaveTextContent(
      "INITIALIZING",
    );
    // Still INITIALIZING after the rAF loop's first flush.
    await waitFor(() =>
      expect(screen.getByTestId("signal-status")).toHaveTextContent(
        "INITIALIZING",
      ),
    );
  });

  it("flips INITIALIZING to SCANNING once scanning begins, even at a zero meter", async () => {
    const view = render(
      <RadarDetectorScreen
        confidence={0}
        audioEnabled={false}
        initializing={true}
      />,
    );
    // The meter is quiescent, so this transition must wake the parked loop
    // and flush with no level change behind it.
    view.rerender(
      <RadarDetectorScreen
        confidence={0}
        audioEnabled={false}
        initializing={false}
      />,
    );
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

describe("RadarDetectorScreen raw confidence readout", () => {
  it("shows the raw model score in place of the percentage", async () => {
    render(
      <RadarDetectorScreen
        confidence={0.5}
        audioEnabled={false}
        rawConfidence={0.75}
      />,
    );
    await waitFor(() => expect(screen.getByText("0.75")).toBeInTheDocument());
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("starts at a zero raw readout, not 0%", () => {
    render(
      <RadarDetectorScreen
        confidence={0}
        audioEnabled={false}
        rawConfidence={0}
      />,
    );
    expect(screen.getByText("0.00")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("drops the raw readout to zero the moment the detection clears, while the dial still decays", async () => {
    const view = render(
      <RadarDetectorScreen
        confidence={0.8}
        audioEnabled={false}
        rawConfidence={0.9}
      />,
    );
    expect(screen.getByText("0.90")).toBeInTheDocument();
    // Wait for the rAF loop to register the signal (and hold its peak) before
    // clearing the detection.
    await waitFor(() =>
      expect(screen.getByTestId("signal-status")).toHaveTextContent("ALERT"),
    );

    // The detection disappears: raw goes to zero immediately (no peak-hold on
    // the readout) even though the peak-held meter is still decaying.
    view.rerender(
      <RadarDetectorScreen
        confidence={0}
        audioEnabled={false}
        rawConfidence={0}
      />,
    );
    await waitFor(() => expect(screen.getByText("0.00")).toBeInTheDocument());
    expect(screen.getByTestId("signal-status")).toHaveTextContent("ALERT");
  });

  it("returns to the percentage when the option turns off at an idle meter", async () => {
    const view = render(
      <RadarDetectorScreen
        confidence={0}
        audioEnabled={false}
        rawConfidence={0}
      />,
    );
    await waitFor(() => expect(screen.getByText("0.00")).toBeInTheDocument());

    // The meter is quiescent, so this must wake the parked loop and flush a
    // readout rewrite with no level change behind it.
    view.rerender(<RadarDetectorScreen confidence={0} audioEnabled={false} />);
    await waitFor(() => expect(screen.getByText("0%")).toBeInTheDocument());
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

  it("renders no card without a contact", () => {
    render(<RadarDetectorScreen confidence={0.5} audioEnabled={false} />);
    expect(screen.queryByTestId("contact-card")).not.toBeInTheDocument();
  });

  it("drops the direction row as soon as the detection clears, keeping the thumbnail", () => {
    const view = render(
      <RadarDetectorScreen
        confidence={0.5}
        audioEnabled={false}
        contact={testContact("left")}
      />,
    );
    expect(screen.getByTestId("contact-direction")).toBeInTheDocument();

    // The detection disappears but the contact lingers through the dial's
    // decay tail: the card (thumbnail) stays, the stale heading must not.
    view.rerender(
      <RadarDetectorScreen
        confidence={0}
        audioEnabled={false}
        contact={testContact("left")}
      />,
    );
    expect(screen.getByTestId("contact-card")).toBeInTheDocument();
    expect(screen.queryByTestId("contact-direction")).not.toBeInTheDocument();
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

describe("RadarDetectorScreen rAF loop", () => {
  it("hides a contact once the meter has fully decayed to zero", async () => {
    render(
      <RadarDetectorScreen
        confidence={0}
        audioEnabled={false}
        contact={testContact("left")}
      />,
    );
    // The card is meter-gated: at zero it fades out. Let the rAF loop tick
    // first so this is not just the pre-tick default.
    await waitFor(() =>
      expect(screen.getByTestId("signal-status")).toHaveTextContent("SCANNING"),
    );
    expect(
      screen.getByTestId("contact-card").closest("[data-contact]"),
    ).toHaveAttribute("data-contact", "false");
  });

  it("parks the rAF loop once the meter is idle", async () => {
    beeperUpdate.mockClear();
    render(<RadarDetectorScreen confidence={0} audioEnabled={true} />);
    // The loop always runs one tick to flush the initial state (which also
    // feeds the beeper), then parks on the quiescent meter: no further ticks.
    await waitFor(() => expect(beeperUpdate).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(beeperUpdate).toHaveBeenCalledTimes(1);
  });

  it("wakes the parked loop when a signal arrives", async () => {
    beeperUpdate.mockClear();
    const view = render(
      <RadarDetectorScreen confidence={0} audioEnabled={true} />,
    );
    await waitFor(() => expect(beeperUpdate).toHaveBeenCalledTimes(1));

    view.rerender(<RadarDetectorScreen confidence={0.9} audioEnabled={true} />);
    await waitFor(() =>
      expect(screen.getByTestId("signal-status")).toHaveTextContent("ALERT"),
    );
    expect(beeperUpdate).toHaveBeenLastCalledWith(0.9, expect.any(Number));
  });
});

describe("RadarDetectorScreen scan sweep", () => {
  // jsdom has no Web Animations API, so the sweep only becomes observable
  // with animate stubbed onto the element prototype.
  const animate = vi.fn<HTMLElement["animate"]>(
    () => ({ cancel: vi.fn() }) as unknown as Animation,
  );
  const originalAnimate = HTMLElement.prototype.animate;

  beforeEach(() => {
    animate.mockClear();
    HTMLElement.prototype.animate = animate;
  });

  afterEach(() => {
    HTMLElement.prototype.animate = originalAnimate;
    vi.restoreAllMocks();
  });

  /** The keyframes the nth sweep step was started with. */
  const stepKeyframes = (call: number): Keyframe[] =>
    animate.mock.calls[call]?.[0] as Keyframe[];

  it("advances the sweep once per completed scan", () => {
    const view = render(
      <RadarDetectorScreen confidence={0} audioEnabled={false} scanAt={1000} />,
    );
    expect(animate).toHaveBeenCalledTimes(1);

    // The next result, detections or not, steps again.
    view.rerender(
      <RadarDetectorScreen confidence={0} audioEnabled={false} scanAt={2050} />,
    );
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it("starts each step where the previous one ended", () => {
    const view = render(
      <RadarDetectorScreen confidence={0} audioEnabled={false} scanAt={1000} />,
    );
    view.rerender(
      <RadarDetectorScreen confidence={0} audioEnabled={false} scanAt={2050} />,
    );
    const first = stepKeyframes(0);
    const second = stepKeyframes(1);
    // Continuity, not specific angles: the rotation must accumulate instead
    // of every step replaying the same arc from zero.
    expect(second[0]?.transform).toBe(first[first.length - 1]?.transform);
    expect(second[0]?.transform).not.toBe(first[0]?.transform);
  });

  it("cancels a superseded step so animations never accumulate", () => {
    const view = render(
      <RadarDetectorScreen confidence={0} audioEnabled={false} scanAt={1000} />,
    );
    const first = animate.mock.results[0]?.value as Animation;
    view.rerender(
      <RadarDetectorScreen confidence={0} audioEnabled={false} scanAt={2050} />,
    );
    expect(first.cancel).toHaveBeenCalled();
  });

  it("does not sweep again on a rerender with no new scan", () => {
    const view = render(
      <RadarDetectorScreen confidence={0} audioEnabled={false} scanAt={1000} />,
    );
    view.rerender(
      <RadarDetectorScreen
        confidence={0.5}
        audioEnabled={false}
        scanAt={1000}
      />,
    );
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("keeps the sweep dark before the first scan", () => {
    render(<RadarDetectorScreen confidence={0} audioEnabled={false} />);
    expect(animate).not.toHaveBeenCalled();
  });

  it("skips the sweep under reduced motion", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList);
    render(
      <RadarDetectorScreen confidence={0} audioEnabled={false} scanAt={1000} />,
    );
    expect(animate).not.toHaveBeenCalled();
  });
});

describe("RadarDetectorScreen detected class", () => {
  it("names the detected class in the status word", async () => {
    render(
      <RadarDetectorScreen
        confidence={0.6}
        audioEnabled={false}
        detectedLabel="PERSON"
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("signal-status")).toHaveTextContent(
        "PERSON DETECTED",
      ),
    );
  });

  it("holds the class through the dial's decay after the detection clears", async () => {
    beeperUpdate.mockClear();
    const view = render(
      <RadarDetectorScreen
        confidence={0.8}
        audioEnabled={false}
        detectedLabel="POLICE"
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("signal-status")).toHaveTextContent(
        "POLICE DETECTED",
      ),
    );

    // The detection clears, so the label goes away, but the peak-held meter is
    // still decaying and still reading a percentage. The word must not snap to
    // SCANNING while the dial still shows a number.
    view.rerender(<RadarDetectorScreen confidence={0} audioEnabled={false} />);
    // The beeper is fed the raw signal on every awake tick, so a zero there
    // proves the loop has actually ticked past the rerender. Asserting
    // straight after the rerender would pass without the hold, since no frame
    // would have run yet.
    await waitFor(() =>
      expect(beeperUpdate).toHaveBeenCalledWith(0, expect.any(Number)),
    );
    expect(screen.getByTestId("signal-status")).toHaveTextContent(
      "POLICE DETECTED",
    );
  });

  it("returns to SCANNING once the meter reaches zero", async () => {
    // Starts just above CONTACT_THRESHOLD so the peak decays to zero in a
    // fraction of a second. A full-strength signal would take DECAY_PER_SEC
    // seconds to fall the whole way and turn this into a multi-second test
    // without exercising anything the small one does not.
    const view = render(
      <RadarDetectorScreen
        confidence={CONTACT_THRESHOLD * 2}
        audioEnabled={false}
        detectedLabel="POLICE"
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("signal-status")).toHaveTextContent(
        "POLICE DETECTED",
      ),
    );

    view.rerender(<RadarDetectorScreen confidence={0} audioEnabled={false} />);
    await waitFor(() =>
      expect(screen.getByTestId("signal-status")).toHaveTextContent("SCANNING"),
    );
  });

  it("swaps to a new class when a more confident one takes over", async () => {
    const view = render(
      <RadarDetectorScreen
        confidence={0.6}
        audioEnabled={false}
        detectedLabel="POLICE"
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("signal-status")).toHaveTextContent(
        "POLICE DETECTED",
      ),
    );

    view.rerender(
      <RadarDetectorScreen
        confidence={0.9}
        audioEnabled={false}
        detectedLabel="PERSON"
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("signal-status")).toHaveTextContent(
        "PERSON DETECTED",
      ),
    );
  });
});
