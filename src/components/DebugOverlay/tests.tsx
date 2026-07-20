import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DebugOverlay } from "@/components/DebugOverlay";
import { SettingsProvider, STORAGE_KEY } from "@/context/SettingsContext";
import type { DebugSnapshot } from "@/context/DetectionContext";
import type { BackendProbe } from "@/workers/detection/types";

afterEach(() => {
  window.localStorage.clear();
});

const enableDebug = () =>
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ showVideo: true, showDebug: true }),
  );

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

const renderOverlay = (backendProbe?: BackendProbe) =>
  render(
    <SettingsProvider>
      <DebugOverlay
        backend="webgpu"
        backendProbe={backendProbe}
        mainThreadWebGpu="no-adapter"
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
    enableDebug();
    renderOverlay();
    expect(screen.getByText(/12 FPS/)).toBeInTheDocument();
    expect(screen.getByText(/1280.*720/)).toBeInTheDocument();
    expect(screen.getByText(/2\s*\/\s*4/)).toBeInTheDocument();
    expect(screen.getByText("overhead")).toBeInTheDocument();
    expect(screen.getByText("2.5 ms")).toBeInTheDocument();
  });

  it("shows the WebGPU probe stages when a probe is present", () => {
    enableDebug();
    renderOverlay({
      workerGpu: true,
      adapter: true,
      device: true,
      shaderF16: false,
      chosen: "wasm",
    });
    expect(screen.getByText(/no-f16/)).toBeInTheDocument();
    expect(screen.getByText(/\bgpu\b/)).toBeInTheDocument();
  });

  it("shows the session error when the WebGPU session failed to build", () => {
    enableDebug();
    renderOverlay({
      workerGpu: true,
      adapter: true,
      device: true,
      shaderF16: false,
      sessionError: "shader-f16 not supported",
      chosen: "wasm",
    });
    expect(screen.getByText("shader-f16 not supported")).toBeInTheDocument();
  });
});
