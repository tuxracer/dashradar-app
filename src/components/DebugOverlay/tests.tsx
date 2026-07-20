import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DebugOverlay } from "@/components/DebugOverlay";
import { SettingsProvider, STORAGE_KEY } from "@/context/SettingsContext";
import type { DebugSnapshot } from "@/context/DetectionContext";

afterEach(() => {
  window.localStorage.clear();
});

const debug: DebugSnapshot = {
  captureMs: 1.2,
  preprocessMs: 3.4,
  inferenceMs: 5.6,
  decodeMs: 7.8,
  roundTripMs: 9.1,
  rawCount: 4,
  filteredCount: 2,
  overheadMs: 2.5,
};

const renderOverlay = () =>
  render(
    <SettingsProvider>
      <DebugOverlay
        backend="webgpu"
        fps={12}
        modelProgress={{ loadedBytes: 0, totalBytes: 0 }}
        debug={debug}
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

  it("renders diagnostics when showDebug is on", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showVideo: true, showDebug: true }),
    );
    renderOverlay();
    expect(screen.getByText(/12 FPS/)).toBeInTheDocument();
    expect(screen.getByText(/1280.*720/)).toBeInTheDocument();
    expect(screen.getByText(/2\s*\/\s*4/)).toBeInTheDocument();
    expect(screen.getByText("overhead")).toBeInTheDocument();
    expect(screen.getByText("2.5 ms")).toBeInTheDocument();
  });
});
