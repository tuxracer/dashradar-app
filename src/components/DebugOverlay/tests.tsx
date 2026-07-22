import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DebugOverlay } from "@/components/DebugOverlay";
import { SettingsProvider, STORAGE_KEY } from "@/context/SettingsContext";
import type { DebugSnapshot } from "@/context/DetectionContext";
import type { YawPitch } from "@/lib/motionSensor";
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
  shownCount: 1,
  overheadMs: 2.5,
  pacingDelayMs: 600,
  pacingRule: "rest",
};

const noMotion = (): YawPitch => ({ yaw: 0, pitch: 0 });

/** Complete probe with quiet defaults; override the fields a test cares about. */
const probe = (overrides: Partial<BackendProbe> = {}): BackendProbe => ({
  workerGpu: true,
  adapter: true,
  device: true,
  shaderF16: false,
  graphCapture: false,
  chosen: "wasm",
  crossOriginIsolated: true,
  threads: 4,
  ...overrides,
});

const renderOverlay = (
  backendProbe?: BackendProbe,
  getMotionDelta: () => YawPitch = noMotion,
) =>
  render(
    <SettingsProvider>
      <DebugOverlay
        backend="webgpu"
        backendProbe={backendProbe}
        mainThreadWebGpu="no-adapter"
        getFps={() => 12}
        modelProgress={{ loadedBytes: 0, totalBytes: 0 }}
        getDebug={() => debug}
        videoSize={{ width: 1280, height: 720 }}
        viewportSize={{ width: 800, height: 400 }}
        getMotionDelta={getMotionDelta}
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
    expect(screen.getByText("pacing")).toBeInTheDocument();
    expect(screen.getByText("600.0 ms · rest")).toBeInTheDocument();
  });

  it("shows the WebGPU probe stages when a probe is present", () => {
    enableDebug();
    renderOverlay(probe());
    expect(screen.getByText(/no-f16/)).toBeInTheDocument();
    expect(screen.getByText(/\bgpu\b/)).toBeInTheDocument();
  });

  it("reports shader-f16 support from the probe", () => {
    enableDebug();
    renderOverlay(probe({ shaderF16: true, chosen: "webgpu" }));
    expect(screen.getByText("shader-f16")).toBeInTheDocument();
    expect(screen.getByText("supported")).toBeInTheDocument();
  });

  it("reports missing WebGPU on the shader-f16 row when the worker has no gpu", () => {
    enableDebug();
    renderOverlay(probe({ workerGpu: false, adapter: false, device: false }));
    expect(screen.getByText("no webgpu")).toBeInTheDocument();
  });

  it("shows the session error when the WebGPU session failed to build", () => {
    enableDebug();
    renderOverlay(probe({ sessionError: "shader-f16 not supported" }));
    expect(screen.getByText("shader-f16 not supported")).toBeInTheDocument();
  });

  it("reports graph capture on when the webgpu session captured", () => {
    enableDebug();
    renderOverlay(
      probe({ shaderF16: true, graphCapture: true, chosen: "webgpu" }),
    );
    expect(screen.getByText("graph capture")).toBeInTheDocument();
    expect(screen.getByText("on")).toBeInTheDocument();
  });

  it("shows the graph capture error when the capture attempt fell back", () => {
    enableDebug();
    renderOverlay(
      probe({
        shaderF16: true,
        chosen: "webgpu",
        graphCaptureError: "capture rejected at run",
      }),
    );
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText("capture rejected at run")).toBeInTheDocument();
  });

  it("marks graph capture disabled when no attempt was made on webgpu", () => {
    enableDebug();
    renderOverlay(probe({ shaderF16: true, chosen: "webgpu" }));
    expect(screen.getByText("disabled")).toBeInTheDocument();
  });

  it("marks graph capture n/a on the wasm backend", () => {
    enableDebug();
    renderOverlay(probe());
    expect(screen.getByText("n/a")).toBeInTheDocument();
  });

  it("shows the WASM thread count and cross-origin isolation state", () => {
    enableDebug();
    renderOverlay(probe({ adapter: false, device: false }));
    expect(screen.getByText(/4T · isolated/)).toBeInTheDocument();
  });
});

describe("DebugOverlay motion readout", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not schedule the readout loop while showDebug is off", () => {
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(0);
    renderOverlay();
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it("renders the motion delta once an animation frame runs", () => {
    // One-shot rAF: the readout tick re-schedules itself, so a mock that always
    // calls cb would recurse infinitely.
    let ran = false;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      if (!ran) {
        ran = true;
        cb(200);
      }
      return 0;
    });
    enableDebug();
    renderOverlay(undefined, () => ({ yaw: 0.1, pitch: 0 }));
    expect(screen.getByText("motion")).toBeInTheDocument();
  });
});
