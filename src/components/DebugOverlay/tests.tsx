import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DebugOverlay } from "@/components/DebugOverlay";
import { SettingsProvider } from "@/context/SettingsContext";
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

const renderOverlay = () =>
  render(
    <SettingsProvider>
      <DebugOverlay
        backendProbe={undefined}
        modelProgress={{ loadedBytes: 0, totalBytes: 0 }}
        getDebug={() => debug}
        videoSize={{ width: 1280, height: 720 }}
        viewportSize={{ width: 800, height: 400 }}
      />
    </SettingsProvider>,
  );

describe("DebugOverlay", () => {
  it("renders nothing when showDebug is off (the default)", () => {
    const { container } = renderOverlay();
    expect(container).toBeEmptyDOMElement();
  });

  // The overlay is off for every real drive, so its readout loop must not cost
  // a frame's work per frame for the whole session.
  it("does not schedule the readout loop while showDebug is off", () => {
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(0);
    renderOverlay();
    expect(rafSpy).not.toHaveBeenCalled();
  });
});
