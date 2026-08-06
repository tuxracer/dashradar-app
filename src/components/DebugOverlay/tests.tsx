import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DebugOverlay } from "@/components/DebugOverlay";
import {
  SETTINGS_VERSION,
  SettingsProvider,
  STORAGE_KEY,
} from "@/context/SettingsContext";
import type { DebugSnapshot } from "@/context/DetectionContext";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const debug: DebugSnapshot = {
  captureMs: 1.2,
  preprocessMs: 3.4,
  inferenceMs: 5.6,
  decodeMs: 7.8,
  roundTripMs: 9.1,
  rawCount: 4,
  filteredCount: 2,
  shownCount: 1,
  overheadMs: 2.5,
  captureFailures: 0,
  pacingDelayMs: 600,
  pacingRule: "rest",
  zoom: 1,
  sceneDelta: 0.4,
  scanSkips: 0,
  scansTotal: 0,
  skipsTotal: 0,
};

const renderOverlay = (getDebug: () => DebugSnapshot = () => debug) =>
  render(
    <SettingsProvider>
      <DebugOverlay
        backendProbe={undefined}
        modelProgress={{ loadedBytes: 0, totalBytes: 0 }}
        getDebug={getDebug}
        videoSize={{ width: 1280, height: 720 }}
        viewportSize={{ width: 800, height: 400 }}
      />
    </SettingsProvider>,
  );

/** Turn the overlay on, which needs the developer master switch on too. */
const enableDebugOverlay = () => {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      settingsVersion: SETTINGS_VERSION,
      developerOptions: true,
      showDebug: true,
    }),
  );
};

describe("DebugOverlay", () => {
  it("renders nothing when showDebug is off (the default)", () => {
    const { container } = renderOverlay();
    expect(container).toBeEmptyDOMElement();
  });

  // The overlay is off for every real drive, so its readout must cost the
  // session nothing at all while it is hidden.
  it("schedules no readout while showDebug is off", () => {
    const interval = vi.spyOn(window, "setInterval");
    const frame = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(0);
    renderOverlay();
    expect(interval).not.toHaveBeenCalled();
    expect(frame).not.toHaveBeenCalled();
  });

  it("polls the snapshot on a timer rather than every frame", async () => {
    // Per-frame polling is what this readout does not need: it is paced in
    // wall time and has nothing to say between ticks.
    enableDebugOverlay();
    const frame = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(0);
    let current = debug;
    renderOverlay(() => current);
    await waitFor(() => expect(screen.getByText("9.1 ms")).toBeInTheDocument());

    current = { ...debug, roundTripMs: 42.3 };
    await waitFor(() =>
      expect(screen.getByText("42.3 ms")).toBeInTheDocument(),
    );
    expect(frame).not.toHaveBeenCalled();
  });
});
