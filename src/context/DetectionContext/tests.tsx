import { track } from "@vercel/analytics";
import { act, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useState } from "react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DetectionProvider,
  FRAME_RETRY_MS,
  MAX_RECONNECT_ATTEMPTS,
  MIN_FRAME_INTERVAL_MS,
  OBSCURED_FRAME_THRESHOLD,
  POLICE_EVENT_DEBOUNCE_MS,
  RECOVERY_HEALTHY_FRAMES,
  STALE_FRAME_THRESHOLD,
  useDetection,
  WATCHDOG_MS,
  WORKER_RECYCLE_AFTER_MS,
} from "@/context/DetectionContext";
import {
  SETTINGS_VERSION,
  SettingsProvider,
  STORAGE_KEY,
  useSettings,
} from "@/context/SettingsContext";
import { APP_RELEASE } from "@/lib/appRelease";
import {
  recordWebGpuCrash,
  SAFE_MODE_CRASH_THRESHOLD,
  SAFE_MODE_STORAGE_KEY,
} from "@/lib/backendSafeMode";
import {
  HEARTBEAT_INTERVAL_MS,
  SENTINEL_STORAGE_KEY,
} from "@/lib/crashSentinel";
import { downloadBlob } from "@/lib/saveFrame";
import { readTimingHistory, TIMING_HISTORY_LIMIT } from "@/lib/timingHistory";
import type { RawDetection } from "@/types";
import {
  MODEL_REVISION,
  MODEL_SLUG,
  ZOOM_2X,
  ZOOM_OFF,
} from "@/workers/detection/consts";

/** Arms the WASM safe mode by recording a full crash streak. */
const armSafeMode = () => {
  for (let i = 0; i < SAFE_MODE_CRASH_THRESHOLD; i += 1) {
    recordWebGpuCrash();
  }
};

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/saveFrame", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/saveFrame")>()),
  downloadBlob: vi.fn(),
}));
import type {
  DebugSnapshot,
  DetectionWorkerLike,
} from "@/context/DetectionContext";
import type { WorkerRequest, WorkerResponse } from "@/workers/detection/types";

class FakeWorker implements DetectionWorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: WorkerRequest[] = [];

  terminate = vi.fn();

  postMessage(message: WorkerRequest) {
    this.posted.push(message);
  }

  emit(message: WorkerResponse) {
    this.onmessage?.(new MessageEvent("message", { data: message }));
  }
}

const Probe = () => {
  const { status, backend, downloadingModel, modelProgress, hud, error } =
    useDetection();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="backend">{backend ?? "none"}</span>
      <span data-testid="downloading">{String(downloadingModel)}</span>
      <span data-testid="loaded">{modelProgress.loadedBytes}</span>
      <span data-testid="objects">
        {hud ? (hud.nearest ? 1 : 0) + hud.others.length : "none"}
      </span>
      <span data-testid="error">{error ?? "none"}</span>
    </div>
  );
};

// The debug snapshot lives in a ref read through getDebugSnapshot() (results
// must not re-render the app), so this probe reads it on demand instead of
// rendering live state.
const DebugProbe = () => {
  const { getDebugSnapshot } = useDetection();
  const [debug, setDebug] = useState<DebugSnapshot>();
  return (
    <div>
      <button
        data-testid="read-debug"
        onClick={() => setDebug(getDebugSnapshot())}
      >
        read debug
      </button>
      <span data-testid="raw">{debug?.rawCount ?? "none"}</span>
      <span data-testid="filtered">{debug?.filteredCount ?? "none"}</span>
      <span data-testid="inference">{debug?.inferenceMs ?? "none"}</span>
      <span data-testid="overhead">{debug?.overheadMs ?? "none"}</span>
      <span data-testid="pacing-delay">{debug?.pacingDelayMs ?? "none"}</span>
      <span data-testid="pacing-rule">{debug?.pacingRule ?? "none"}</span>
      <span data-testid="bright">{debug?.brightFraction ?? "none"}</span>
    </div>
  );
};

const StartOnReady = () => {
  const { status, start } = useDetection();
  return (
    <button
      onClick={() => start(document.createElement("video"))}
      data-testid="start"
      data-status={status}
    >
      start
    </button>
  );
};

const StartStop = () => {
  const { start, stop } = useDetection();
  return (
    <>
      <button
        onClick={() => start(document.createElement("video"))}
        data-testid="start"
      >
        start
      </button>
      <button onClick={() => stop()} data-testid="stop">
        stop
      </button>
    </>
  );
};

const StartStopWithVideo = ({ video }: { video: HTMLVideoElement }) => {
  const { start, stop } = useDetection();
  return (
    <>
      <button onClick={() => start(video)} data-testid="start">
        start
      </button>
      <button onClick={() => stop()} data-testid="stop">
        stop
      </button>
    </>
  );
};

const RecoveryProbe = ({ video }: { video: HTMLVideoElement }) => {
  const { cameraStalled, cameraEpoch, start } = useDetection();
  return (
    <>
      <button onClick={() => start(video)} data-testid="start">
        start
      </button>
      <span data-testid="camera-stalled">{String(cameraStalled)}</span>
      <span data-testid="camera-epoch">{cameraEpoch}</span>
    </>
  );
};

const SettingsToggle = () => {
  const { openSettings, closeSettings } = useSettings();
  return (
    <>
      <button data-testid="open-settings" onClick={() => openSettings()}>
        open
      </button>
      <button data-testid="close-settings" onClick={() => closeSettings()}>
        close
      </button>
    </>
  );
};

const renderWithProvider = (
  ui: ReactNode,
  options?: { devVideoMode?: boolean },
) => {
  const worker = new FakeWorker();
  render(
    <SettingsProvider>
      <DetectionProvider
        createWorker={() => worker}
        devVideoMode={options?.devVideoMode}
      >
        {ui}
      </DetectionProvider>
    </SettingsProvider>,
  );
  return worker;
};

const fakeBitmap = () => {
  return {
    width: 1280,
    height: 720,
    close: () => {},
  } as unknown as ImageBitmap;
};

/**
 * Emit one detections result with the given fingerprint and optional
 * brightFraction. Assumes the pump has already posted a detect frame (a prior
 * present + prime). These tests run under `vi.useFakeTimers()`, so callers
 * step the pump between rounds by calling `presentFrame()` and advancing the
 * fake timers, not by awaiting real elapsed time.
 */
const emitDetections = (
  worker: FakeWorker,
  fingerprint: number,
  brightFraction?: number,
) => {
  worker.emit({
    type: "detections",
    detections: [],
    timing: { preprocessMs: 1, inferenceMs: 2, decodeMs: 3 },
    fingerprint,
    brightFraction,
  });
};

/**
 * A video element whose requestVideoFrameCallback is under test control:
 * callbacks queue up until presentFrame() fires them, simulating the camera
 * presenting a new frame. jsdom's video element has no rVFC of its own, so
 * assigning one exercises the pump's wait-for-new-frame path.
 */
const videoWithControlledFrames = () => {
  const callbacks: VideoFrameRequestCallback[] = [];
  const video = document.createElement("video");
  video.requestVideoFrameCallback = (callback) => {
    callbacks.push(callback);
    return callbacks.length;
  };
  const presentFrame = () => {
    for (const callback of callbacks.splice(0)) {
      callback(performance.now(), {
        presentationTime: 0,
        expectedDisplayTime: 0,
        width: 512,
        height: 512,
        mediaTime: 0,
        presentedFrames: 1,
      });
    }
  };
  return { video, presentFrame };
};

/** Fake the page's visibility state and fire the matching event. */
const setDocumentVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  // restoreAllMocks does not reset a vi.fn() created by a module mock factory.
  vi.mocked(track).mockClear();
  vi.mocked(downloadBlob).mockClear();
  // Restore the prototype visibilityState getter shadowed by
  // setDocumentVisibility, so later tests see jsdom's real value.
  Reflect.deleteProperty(document, "visibilityState");
  // A seeded showDebug (or any other persisted setting) must not leak between
  // tests: SettingsProvider persists its state to localStorage on mount.
  window.localStorage.clear();
  // Every detection result appends to the rolling timing window.
  window.sessionStorage.clear();
});

describe("DetectionProvider", () => {
  it("starts loading the model on mount", async () => {
    const worker = renderWithProvider(<Probe />);
    expect(screen.getByTestId("status").textContent).toBe("loading-model");
    // The load message is deferred to a microtask (Promise.resolve in tests),
    // so wait for it rather than asserting synchronously.
    await waitFor(() => {
      expect(worker.posted).toContainEqual({ type: "load", forceWasm: false });
    });
  });

  it("requests the wasm backend when the safe mode is armed", async () => {
    armSafeMode();
    const worker = renderWithProvider(<Probe />);
    await waitFor(() => {
      expect(worker.posted).toContainEqual({ type: "load", forceWasm: true });
    });
  });

  it("reports a safe_mode_load event when the model becomes ready under safe mode", async () => {
    armSafeMode();
    const worker = renderWithProvider(<Probe />);
    await waitFor(() => {
      expect(worker.posted).toContainEqual({ type: "load", forceWasm: true });
    });
    expect(track).not.toHaveBeenCalledWith("safe_mode_load");
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    expect(track).toHaveBeenCalledWith("safe_mode_load");
    expect(
      vi.mocked(track).mock.calls.filter(([name]) => name === "safe_mode_load"),
    ).toHaveLength(1);
  });

  it("does not report safe_mode_load on a normal ready", async () => {
    const worker = renderWithProvider(<Probe />);
    await waitFor(() => {
      expect(worker.posted).toContainEqual({ type: "load", forceWasm: false });
    });
    act(() => {
      worker.emit({ type: "ready", backend: "webgpu" });
    });
    expect(track).not.toHaveBeenCalledWith("safe_mode_load");
  });

  it("flags a network download when the model is not cached", () => {
    const worker = renderWithProvider(<Probe />);
    expect(screen.getByTestId("downloading").textContent).toBe("false");
    act(() => {
      worker.emit({ type: "model-load-start", fromCache: false });
    });
    expect(screen.getByTestId("downloading").textContent).toBe("true");
  });

  it("does not flag a download when the model loads from cache", () => {
    const worker = renderWithProvider(<Probe />);
    act(() => {
      worker.emit({ type: "model-load-start", fromCache: true });
    });
    expect(screen.getByTestId("downloading").textContent).toBe("false");
  });

  it("accumulates per-file model progress", () => {
    const worker = renderWithProvider(<Probe />);
    act(() => {
      worker.emit({
        type: "model-progress",
        progress: { file: "model.onnx", loaded: 50, total: 100 },
      });
      worker.emit({
        type: "model-progress",
        progress: { file: "model.onnx", loaded: 80, total: 100 },
      });
      worker.emit({
        type: "model-progress",
        progress: { file: "config.json", loaded: 10, total: 10 },
      });
    });
    expect(screen.getByTestId("loaded").textContent).toBe("90");
  });

  it("moves to ready when the worker reports ready", () => {
    const worker = renderWithProvider(<Probe />);
    act(() => {
      worker.emit({ type: "ready", backend: "webgpu" });
    });
    expect(screen.getByTestId("status").textContent).toBe("ready");
    expect(screen.getByTestId("backend").textContent).toBe("webgpu");
  });

  it("surfaces worker errors", () => {
    const worker = renderWithProvider(<Probe />);
    act(() => {
      worker.emit({ type: "worker-error", code: "MODEL_LOAD_FAILED" });
    });
    expect(screen.getByTestId("status").textContent).toBe("error");
    expect(screen.getByTestId("error").textContent).toBe("MODEL_LOAD_FAILED");
  });

  it("reports the resolved backend and model load on ready", () => {
    const worker = renderWithProvider(<Probe />);
    act(() => {
      worker.emit({ type: "model-load-start", fromCache: false });
      worker.emit({ type: "ready", backend: "webgpu" });
    });
    expect(track).toHaveBeenCalledWith("backend_resolved", {
      backend: "webgpu",
    });
    expect(track).toHaveBeenCalledWith("model_ready", {
      backend: "webgpu",
      fromCache: false,
    });
  });

  it("reports a cache hit in the model_ready event", () => {
    const worker = renderWithProvider(<Probe />);
    act(() => {
      worker.emit({ type: "model-load-start", fromCache: true });
      worker.emit({ type: "ready", backend: "wasm" });
    });
    expect(track).toHaveBeenCalledWith("model_ready", {
      backend: "wasm",
      fromCache: true,
    });
  });

  it("reports the model and revision when the weights download", () => {
    const worker = renderWithProvider(<Probe />);
    act(() => {
      worker.emit({ type: "model-load-start", fromCache: false });
      worker.emit({
        type: "model-downloaded",
        backend: "webgpu",
        durationMs: 8_400,
      });
    });
    expect(track).toHaveBeenCalledWith("model_downloaded", {
      model: MODEL_SLUG,
      revision: MODEL_REVISION,
      backend: "webgpu",
      seconds: 8,
    });
  });

  it("reports a downloaded model once per page load", () => {
    const worker = renderWithProvider(<Probe />);
    act(() => {
      worker.emit({
        type: "model-downloaded",
        backend: "wasm",
        durationMs: 1_000,
      });
      worker.emit({
        type: "model-downloaded",
        backend: "wasm",
        durationMs: 1_000,
      });
    });
    expect(
      vi
        .mocked(track)
        .mock.calls.filter(([name]) => name === "model_downloaded"),
    ).toHaveLength(1);
  });

  it("reports the first successful inference to analytics once", () => {
    const worker = renderWithProvider(<Probe />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    expect(track).not.toHaveBeenCalledWith(
      "first_inference",
      expect.anything(),
    );
    const result = {
      type: "detections" as const,
      detections: [],
      timing: { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 },
    };
    act(() => {
      worker.emit(result);
    });
    expect(track).toHaveBeenCalledWith("first_inference", {
      backend: "wasm",
      seconds: expect.any(Number),
    });
    expect(track).toHaveBeenCalledWith("first_round_trip", {
      backend: "wasm",
      seconds: expect.any(Number),
    });
    // Later scans are silent: the events mark the session getting to
    // inference, not each frame.
    act(() => {
      worker.emit(result);
      worker.emit(result);
    });
    expect(
      vi.mocked(track).mock.calls.filter(([name]) => name.startsWith("first_")),
    ).toHaveLength(2);
  });

  it("reports worker errors to analytics", () => {
    const worker = renderWithProvider(<Probe />);
    act(() => {
      worker.emit({ type: "worker-error", code: "MODEL_LOAD_FAILED" });
    });
    expect(track).toHaveBeenCalledWith("error", { code: "MODEL_LOAD_FAILED" });
  });

  it("reports a worker crash to analytics", () => {
    const worker = renderWithProvider(<Probe />);
    act(() => {
      worker.onerror?.(new ErrorEvent("error"));
    });
    expect(track).toHaveBeenCalledWith("error", { code: "WORKER_CRASHED" });
  });

  it("pumps a frame after start and another after each result", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(
      <>
        <Probe />
        <StartOnReady />
      </>,
    );
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(1);
    act(() => {
      worker.emit({
        type: "detections",
        detections: [
          {
            label: "car",
            score: 0.9,
            box: { xmin: 0.4, ymin: 0.5, xmax: 0.6, ymax: 0.8 },
          },
        ],
        timing: { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 },
      });
    });
    expect(screen.getByTestId("status").textContent).toBe("running");
    // The tracker registers a detection on its first frame, so its blip
    // reaches the HUD immediately.
    expect(screen.getByTestId("objects").textContent).toBe("1");
    // The next frame goes out once the pacing interval elapses.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
    });
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(2);
  });

  it("retries frame capture after createImageBitmap fails once", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("video has no frame data"))
        .mockImplementation(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    // First capture rejects (no detect posted), scheduling a retry.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(0);
    // The retry fires after FRAME_RETRY_MS and succeeds.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FRAME_RETRY_MS);
    });
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(1);
  });

  it("paces the next frame to the minimum interval after a fast result", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    // Flush the capture microtask: the first frame posts immediately.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(1);
    // A result arriving well before the pacing floor must not re-prime the
    // pump immediately (the old behavior posted on the next microtask).
    act(() => {
      worker.emit({
        type: "detections",
        detections: [],
        timing: { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(1);
    // Once the interval elapses, exactly one more frame goes out.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
    });
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(2);
  });

  it("rests a fraction of the round trip after a slow result", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready", backend: "webgpu" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(1);
    // Simulate a slow device: the result lands 3000 ms after the frame was
    // posted, well past the pacing floor, so the rest ratio governs instead.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    act(() => {
      worker.emit({
        type: "detections",
        detections: [],
        timing: { preprocessMs: 5, inferenceMs: 2_990, decodeMs: 5 },
      });
    });
    // The pump must not re-prime immediately: it rests PACING_REST_RATIO of
    // the round trip (1500 ms here), so 1400 ms in nothing new is posted.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_400);
    });
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(1);
    // Once the rest elapses, exactly one more frame goes out.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(2);
  });

  it("reports a police sighting once per encounter", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // Ready emits backend_resolved/model_ready; drop those so the assertions
    // below count only the police event.
    vi.mocked(track).mockClear();
    // Count police sightings specifically, not every track call: the long
    // debounce-window advance below outlasts the watchdog, which fires its own
    // camera_stall event that is irrelevant to this test.
    const policeSightings = () =>
      vi
        .mocked(track)
        .mock.calls.filter(([event]) => event === "police_detected");

    const police = {
      label: "police",
      score: 0.9,
      box: { xmin: 0.4, ymin: 0.5, xmax: 0.6, ymax: 0.8 },
    };
    const timing = { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 };

    // First sighting fires the event.
    act(() => {
      worker.emit({ type: "detections", detections: [police], timing });
    });
    expect(policeSightings()).toHaveLength(1);

    // A second sighting within the debounce window is the same encounter.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    act(() => {
      worker.emit({ type: "detections", detections: [police], timing });
    });
    expect(policeSightings()).toHaveLength(1);

    // After police are absent past the debounce window, a sighting re-fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLICE_EVENT_DEBOUNCE_MS);
    });
    act(() => {
      worker.emit({ type: "detections", detections: [police], timing });
    });
    expect(policeSightings()).toHaveLength(2);
  });

  it("does not report an event when no police are detected", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // Ready emits backend_resolved/model_ready and the first result emits
    // first_inference; only the police event is under test here.
    vi.mocked(track).mockClear();
    act(() => {
      worker.emit({
        type: "detections",
        detections: [],
        timing: { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 },
      });
    });
    expect(track).not.toHaveBeenCalledWith("police_detected");
  });

  it("does not pump a paced frame scheduled before stop()", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartStop />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // The result schedules a paced frame, then stop() lands before it fires.
    act(() => {
      worker.emit({
        type: "detections",
        detections: [],
        timing: { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 },
      });
    });
    act(() => {
      screen.getByTestId("stop").click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS * 2);
    });
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(1);
  });

  it("captures only when the camera presents a new frame", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const { video, presentFrame } = videoWithControlledFrames();
    const worker = new FakeWorker();
    render(
      <SettingsProvider>
        <DetectionProvider createWorker={() => worker}>
          <StartStopWithVideo video={video} />
        </DetectionProvider>
      </SettingsProvider>,
    );
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    // No camera frame has been presented yet: the pump must hold the capture.
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(0);
    await act(async () => {
      presentFrame();
    });
    await waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === "detect"),
      ).toHaveLength(1);
    });
  });

  it("discards a capture whose camera frame arrives after stop", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const { video, presentFrame } = videoWithControlledFrames();
    const worker = new FakeWorker();
    render(
      <SettingsProvider>
        <DetectionProvider createWorker={() => worker}>
          <StartStopWithVideo video={video} />
        </DetectionProvider>
      </SettingsProvider>,
    );
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    // Stop lands while the pump is still waiting for a camera frame; the
    // frame arriving afterwards must not trigger a capture.
    act(() => {
      screen.getByTestId("stop").click();
    });
    await act(async () => {
      presentFrame();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(0);
  });

  it("keeps one frame in flight across a fast stop-then-start", async () => {
    let closedFrames = 0;
    const pendingCaptures: Array<(bitmap: ImageBitmap) => void> = [];
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(
        () =>
          new Promise<ImageBitmap>((resolve) => {
            pendingCaptures.push(resolve);
          }),
      ),
    );
    const countingBitmap = () => {
      return {
        width: 1280,
        height: 720,
        close: () => {
          closedFrames += 1;
        },
      } as unknown as ImageBitmap;
    };
    const worker = renderWithProvider(<StartStop />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    // Flush the frame-wait microtask so capture #1 is pending, then stop and
    // quickly start again (capture #2).
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      screen.getByTestId("stop").click();
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      for (const resolveCapture of pendingCaptures.splice(0)) {
        resolveCapture(countingBitmap());
      }
    });
    // Only the restarted pump's frame is posted; the stale one is closed.
    await waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === "detect"),
      ).toHaveLength(1);
    });
    expect(closedFrames).toBe(1);
  });

  it("posts exactly one frame per start under StrictMode", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = new FakeWorker();
    render(
      <StrictMode>
        <SettingsProvider>
          <DetectionProvider createWorker={() => worker}>
            <StartOnReady />
          </DetectionProvider>
        </SettingsProvider>
      </StrictMode>,
    );
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === "detect"),
      ).toHaveLength(1);
    });
    // Flush any second (double-invoked) capture before asserting the count
    // did not grow past one.
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(1);
  });

  it("re-primes at depth one when a stale result lands after stop/start", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartStop />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    // Frame #1 reaches the worker; its result is still pending.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(1);
    // Stop, then restart before the stale result comes back.
    act(() => {
      screen.getByTestId("stop").click();
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    // The restarted pump must not post while frame #1's result is pending.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(1);
    // The stale result re-primes the pump: exactly one more post once the
    // pacing interval elapses.
    act(() => {
      worker.emit({
        type: "detections",
        detections: [],
        timing: { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
    });
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(2);
    // Pipeline continues at depth one: the next result posts exactly one more.
    act(() => {
      worker.emit({
        type: "detections",
        detections: [],
        timing: { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
    });
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(3);
  });

  it("exposes a debug snapshot from detection results", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(
      <>
        <DebugProbe />
        <StartOnReady />
      </>,
    );
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    // Post a real frame so the round trip (and the pacing derived from it)
    // measures from an actual send, not the ref's initial zero.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => {
      worker.emit({
        type: "detections",
        detections: [
          {
            label: "car",
            score: 0.9,
            box: { xmin: 0.4, ymin: 0.5, xmax: 0.6, ymax: 0.8 },
          },
        ],
        timing: { preprocessMs: 1, inferenceMs: 2, decodeMs: 3 },
      });
    });
    act(() => {
      screen.getByTestId("read-debug").click();
    });
    expect(screen.getByTestId("raw").textContent).toBe("1");
    expect(screen.getByTestId("filtered").textContent).toBe("1");
    expect(screen.getByTestId("inference").textContent).toBe("2");
    const overhead = Number(screen.getByTestId("overhead").textContent);
    expect(Number.isFinite(overhead)).toBe(true);
    expect(overhead).toBeGreaterThanOrEqual(0);
    // The result came back near-instantly, so the pacing floor set the delay.
    expect(screen.getByTestId("pacing-rule").textContent).toBe("floor");
    const pacingDelay = Number(screen.getByTestId("pacing-delay").textContent);
    expect(pacingDelay).toBeGreaterThan(0);
    expect(pacingDelay).toBeLessThanOrEqual(MIN_FRAME_INTERVAL_MS);
  });

  it("rolls each result's timings into the sessionStorage history", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(readTimingHistory()).toEqual({ roundTrip: [], inference: [] });

    act(() => {
      worker.emit({
        type: "detections",
        detections: [],
        // Two and a half seconds of inference buckets to 2.5; the round trip
        // is measured here rather than reported, so only its length matters.
        timing: { preprocessMs: 1, inferenceMs: 2_500, decodeMs: 3 },
      });
    });
    const history = readTimingHistory();
    expect(history.inference).toEqual([2.5]);
    expect(history.roundTrip).toHaveLength(1);
  });

  it("reports the first scan's inference time and round trip as two events", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // The frame is in flight for four seconds, of which the worker spent 2400
    // ms in inference, so the two events carry different numbers.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    act(() => {
      worker.emit({
        type: "detections",
        detections: [],
        timing: { preprocessMs: 400, inferenceMs: 2_400, decodeMs: 400 },
      });
    });
    expect(track).toHaveBeenCalledWith("first_inference", {
      backend: "wasm",
      seconds: 2.5,
    });
    expect(track).toHaveBeenCalledWith("first_round_trip", {
      backend: "wasm",
      seconds: 4,
    });
  });

  it("reports median timings to analytics once the window first fills", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const { video, presentFrame } = videoWithControlledFrames();
    const worker = renderWithProvider(<StartStopWithVideo video={video} />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });

    /** Run `count` scans, each reporting a one-second inference. */
    const runScans = async (count: number, firstFingerprint: number) => {
      for (let scan = 0; scan < count; scan += 1) {
        await act(async () => {
          presentFrame();
          await vi.advanceTimersByTimeAsync(0);
        });
        act(() => {
          worker.emit({
            type: "detections",
            detections: [],
            timing: { preprocessMs: 1, inferenceMs: 1_000, decodeMs: 1 },
            // Distinct each scan, so the frozen-feed detector never fires.
            fingerprint: firstFingerprint + scan,
            brightFraction: 0.5,
          });
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
        });
      }
    };
    const timingEvents = () =>
      vi
        .mocked(track)
        .mock.calls.filter(([event]) => event.startsWith("timing_"));

    // A partial window reports nothing: a median of a couple of readings is
    // not worth an event.
    await runScans(TIMING_HISTORY_LIMIT - 1, 1);
    expect(timingEvents()).toHaveLength(0);

    // The next scan fills the window and reports both medians.
    await runScans(1, 100);
    expect(timingEvents()).toEqual([
      ["timing_round_trip", { seconds: expect.any(Number) }],
      ["timing_inference", { seconds: 1 }],
    ]);

    // The drive keeps scanning, and the window keeps rolling; neither event
    // may fire a second time.
    await runScans(TIMING_HISTORY_LIMIT, 200);
    expect(timingEvents()).toHaveLength(2);
  });

  it("runs unthrottled (zero pacing delay) when developer options are on and throttling is off", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true, throttleInference: false }),
    );
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(
      <>
        <DebugProbe />
        <StartOnReady />
      </>,
    );
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => {
      worker.emit({
        type: "detections",
        detections: [],
        timing: { preprocessMs: 1, inferenceMs: 2, decodeMs: 3 },
      });
    });
    act(() => {
      screen.getByTestId("read-debug").click();
    });
    const pacingDelay = Number(screen.getByTestId("pacing-delay").textContent);
    expect(pacingDelay).toBe(0);
  });

  it("keeps the pacing floor when throttling is off but developer options are off", async () => {
    // The unthrottle escape hatch is gated on the Developer options master
    // switch: a stored throttleInference=false must NOT remove the floor while
    // developerOptions is off, so a phone can never run flat-out on a normal
    // drive. This pins the gate SettingsProvider applies; without it a
    // provider that passed the stored value straight through would pass every
    // other test.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: false, throttleInference: false }),
    );
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(
      <>
        <DebugProbe />
        <StartOnReady />
      </>,
    );
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => {
      worker.emit({
        type: "detections",
        detections: [],
        timing: { preprocessMs: 1, inferenceMs: 2, decodeMs: 3 },
      });
    });
    act(() => {
      screen.getByTestId("read-debug").click();
    });
    const pacingDelay = Number(screen.getByTestId("pacing-delay").textContent);
    expect(pacingDelay).toBeGreaterThan(0);
  });

  it("records brightFraction from the detections message in the debug snapshot", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(
      <>
        <DebugProbe />
        <StartOnReady />
      </>,
    );
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    // Post a real frame so the detections handler below has an in-flight
    // capture to resolve.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => {
      emitDetections(worker, 1, 0.37);
    });
    act(() => {
      screen.getByTestId("read-debug").click();
    });
    expect(Number(screen.getByTestId("bright").textContent)).toBeCloseTo(0.37);
  });

  it("auto-starts detection when ready arrives after start", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      screen.getByTestId("start").click();
    });
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(0);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    await waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === "detect"),
      ).toHaveLength(1);
    });
  });

  it("surfaces a detection immediately on its first frame", () => {
    const worker = renderWithProvider(<Probe />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      worker.emit({
        type: "detections",
        detections: [
          {
            label: "police",
            score: 0.9,
            box: { xmin: 0.4, ymin: 0.5, xmax: 0.6, ymax: 0.8 },
          },
        ],
        timing: { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 },
      });
    });
    expect(screen.getByTestId("objects").textContent).toBe("1");
  });

  it("coasts a detection's box through a frame the model misses it", () => {
    const worker = renderWithProvider(<Probe />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    const detection = {
      label: "police",
      score: 0.9,
      box: { xmin: 0.4, ymin: 0.5, xmax: 0.6, ymax: 0.8 },
    };
    const timing = { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 };
    // First sighting: shown immediately.
    act(() => {
      worker.emit({ type: "detections", detections: [detection], timing });
    });
    expect(screen.getByTestId("objects").textContent).toBe("1");
    // Next frame has no detections: the track coasts, so the box stays shown.
    act(() => {
      worker.emit({ type: "detections", detections: [], timing });
    });
    expect(screen.getByTestId("objects").textContent).toBe("1");
  });

  it("asks for neither the frame nor a thumbnail while developer options are off", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === "detect"),
      ).toHaveLength(1);
    });
    expect(
      worker.posted.find((message) => message.type === "detect"),
    ).toMatchObject({ includeFrame: false, includeThumbnail: false });
  });

  // The contact card is the crop's only consumer in a normal drive, so turning
  // the detection image off stops the worker cutting one at all.
  it("stops asking for the crop while the detection image is off", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ detectionImage: false }),
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === "detect"),
      ).toHaveLength(1);
    });
    expect(
      worker.posted.find((message) => message.type === "detect"),
    ).toMatchObject({ includeCrop: false });
  });

  it("asks for the crop while the detection image is on", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === "detect"),
      ).toHaveLength(1);
    });
    expect(
      worker.posted.find((message) => message.type === "detect"),
    ).toMatchObject({ includeCrop: true });
  });

  // Auto save reads the cutout's validated detection as its signal that a scan
  // is worth downloading, so it has to keep the request alive on its own.
  it("keeps asking for the crop for auto save with the detection image off", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        developerOptions: true,
        autoSaveFrames: true,
        detectionImage: false,
      }),
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === "detect"),
      ).toHaveLength(1);
    });
    expect(
      worker.posted.find((message) => message.type === "detect"),
    ).toMatchObject({ includeCrop: true });
  });

  // The per-scan preview extends the contact card, so with no card there is
  // nothing for it to extend and no reason to pay for the thumbnail.
  it("stops asking for the thumbnail while the detection image is off", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        settingsVersion: SETTINGS_VERSION,
        developerOptions: true,
        frameThumbnails: true,
        detectionImage: false,
      }),
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === "detect"),
      ).toHaveLength(1);
    });
    expect(
      worker.posted.find((message) => message.type === "detect"),
    ).toMatchObject({ includeThumbnail: false });
  });

  // The two flags are separate settings, so each has to reach the worker on its
  // own rather than riding along with the debug overlay.
  it("posts includeFrame true while frame saving is on, and nothing else", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        settingsVersion: SETTINGS_VERSION,
        developerOptions: true,
        saveFrames: true,
        frameThumbnails: false,
      }),
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === "detect"),
      ).toHaveLength(1);
    });
    expect(
      worker.posted.find((message) => message.type === "detect"),
    ).toMatchObject({ includeFrame: true, includeThumbnail: false });
  });

  // Auto save needs the same frame JPEG the SAVE button uses, so it has to
  // ask for it on its own rather than depending on Save frames being on too.
  it("posts includeFrame true for auto save even with frame saving off", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        developerOptions: true,
        saveFrames: false,
        autoSaveFrames: true,
      }),
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === "detect"),
      ).toHaveLength(1);
    });
    expect(
      worker.posted.find((message) => message.type === "detect"),
    ).toMatchObject({ includeFrame: true });
  });

  it("posts includeThumbnail true while the frame preview is on, and nothing else", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        settingsVersion: SETTINGS_VERSION,
        developerOptions: true,
        saveFrames: false,
        frameThumbnails: true,
      }),
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === "detect"),
      ).toHaveLength(1);
    });
    expect(
      worker.posted.find((message) => message.type === "detect"),
    ).toMatchObject({ includeFrame: false, includeThumbnail: true });
  });

  it("posts the unzoomed crop factor on the default auto mode's first scan", async () => {
    // The default mode is auto, whose machine always starts a session zoomed
    // out; the alternation from there is covered by the auto zoom tests below.
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === "detect"),
      ).toHaveLength(1);
    });
    expect(
      worker.posted.find((message) => message.type === "detect"),
    ).toMatchObject({ zoom: ZOOM_OFF });
  });

  it("posts the 2x crop factor when developer options are on and the 2x mode is selected", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true, zoomMode: "2x" }),
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === "detect"),
      ).toHaveLength(1);
    });
    expect(
      worker.posted.find((message) => message.type === "detect"),
    ).toMatchObject({ zoom: ZOOM_2X });
  });

  it("ignores a stored fixed zoom when developer options are off", async () => {
    // A fixed 1x/2x is a developer override gated on the master switch: with
    // it off, a stored 2x must not pin the scan and the auto default runs
    // instead. Auto's machine starts a session zoomed out, so the first frame
    // posting ZOOM_OFF (not the stored ZOOM_2X) pins the gate.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: false, zoomMode: "2x" }),
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === "detect"),
      ).toHaveLength(1);
    });
    expect(
      worker.posted.find((message) => message.type === "detect"),
    ).toMatchObject({ zoom: ZOOM_OFF });
  });

  // Auto zoom mode. These tests run the pump through several scans under fake
  // timers: each round emits a detections result and advances past the pacing
  // floor so the next detect posts, then asserts the crop factor it carried.
  // The fake bitmap is 1280x720, whose margin-inset 2x region normalizes to
  // x 0.3875..0.6125, y 0.3..0.7.
  const postedZooms = (worker: FakeWorker) =>
    worker.posted
      .filter((message) => message.type === "detect")
      .map((message) => message.zoom);

  const ZoomLevelProbe = () => {
    const { autoZoom } = useDetection();
    return (
      <>
        <span data-testid="auto-zoom-level">{autoZoom.zoom}</span>
        <span data-testid="auto-zoom-locked">{String(autoZoom.locked)}</span>
      </>
    );
  };

  const startAutoZoomPump = async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true, zoomMode: "auto" }),
    );
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(
      <>
        <StartOnReady />
        <ZoomLevelProbe />
      </>,
    );
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    return worker;
  };

  const completeScan = async (
    worker: FakeWorker,
    detections: RawDetection[],
  ) => {
    act(() => {
      worker.emit({
        type: "detections",
        detections,
        timing: { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
    });
  };

  const smallCenteredPolice = {
    label: "police",
    score: 0.9,
    box: { xmin: 0.45, ymin: 0.45, xmax: 0.55, ymax: 0.55 },
  };

  const widePolice = {
    label: "police",
    score: 0.9,
    box: { xmin: 0.3, ymin: 0.4, xmax: 0.7, ymax: 0.6 },
  };

  it("alternates the crop factor between scans while nothing is detected in auto mode", async () => {
    const worker = await startAutoZoomPump();
    await completeScan(worker, []);
    await completeScan(worker, []);
    await completeScan(worker, []);
    expect(postedZooms(worker)).toEqual([ZOOM_OFF, ZOOM_2X, ZOOM_OFF, ZOOM_2X]);
  });

  it("locks at 2x while a detection is present in the 2x view", async () => {
    const worker = await startAutoZoomPump();
    // Scan 1 (1x): nothing, flip to 2x. Scans 2 and 3 (2x): detection holds
    // the lock instead of alternating away.
    await completeScan(worker, []);
    await completeScan(worker, [smallCenteredPolice]);
    await completeScan(worker, [smallCenteredPolice]);
    expect(postedZooms(worker)).toEqual([ZOOM_OFF, ZOOM_2X, ZOOM_2X, ZOOM_2X]);
  });

  it("zooms in on a 1x detection that fits the 2x view", async () => {
    const worker = await startAutoZoomPump();
    await completeScan(worker, [smallCenteredPolice]);
    expect(postedZooms(worker)).toEqual([ZOOM_OFF, ZOOM_2X]);
  });

  it("locks at 1x when zooming in would crop the detection out", async () => {
    const worker = await startAutoZoomPump();
    // The wide box spills past the 2x region on both x edges, so auto must
    // hold 1x for as long as it is detected rather than alternating to 2x
    // and losing it.
    await completeScan(worker, [widePolice]);
    await completeScan(worker, [widePolice]);
    expect(postedZooms(worker)).toEqual([ZOOM_OFF, ZOOM_OFF, ZOOM_OFF]);
  });

  it("releases a 2x lock by zooming out once the tracker drops the object", async () => {
    const worker = await startAutoZoomPump();
    await completeScan(worker, []);
    await completeScan(worker, [smallCenteredPolice]);
    // The coasting tracker holds the stale box for MAX_MISSES (2) empty
    // scans, keeping the lock; the third empty scan drops it and the machine
    // zooms out first.
    await completeScan(worker, []);
    await completeScan(worker, []);
    await completeScan(worker, []);
    await completeScan(worker, []);
    expect(postedZooms(worker)).toEqual([
      ZOOM_OFF,
      ZOOM_2X,
      ZOOM_2X,
      ZOOM_2X,
      ZOOM_2X,
      ZOOM_OFF,
      ZOOM_2X,
    ]);
  });

  it("exposes the machine's level and lock state for the zoom indicator", async () => {
    const worker = await startAutoZoomPump();
    const level = () => screen.getByTestId("auto-zoom-level").textContent;
    const locked = () => screen.getByTestId("auto-zoom-locked").textContent;
    expect(level()).toBe(String(ZOOM_OFF));
    expect(locked()).toBe("false");
    // Empty scan at 1x: alternate up to 2x, unlocked.
    await completeScan(worker, []);
    expect(level()).toBe(String(ZOOM_2X));
    expect(locked()).toBe("false");
    // Detection at 2x: hold the level, locked.
    await completeScan(worker, [smallCenteredPolice]);
    expect(level()).toBe(String(ZOOM_2X));
    expect(locked()).toBe("true");
  });

  it("posts confidenceThreshold 0.5 by default", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === "detect"),
      ).toHaveLength(1);
    });
    expect(
      worker.posted.find((message) => message.type === "detect"),
    ).toMatchObject({ confidenceThreshold: 0.5 });
  });

  it("posts the stored confidenceThreshold when developer options are on", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true, confidenceThreshold: 0.2 }),
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === "detect"),
      ).toHaveLength(1);
    });
    expect(
      worker.posted.find((message) => message.type === "detect"),
    ).toMatchObject({ confidenceThreshold: 0.2 });
  });

  it("posts confidenceThreshold 0.5 when a stored override exists but developer options are off", async () => {
    // Gated on the Developer options master switch: a stored override must NOT
    // take effect while developerOptions is off, so normal use always filters
    // at the 0.5 production floor.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: false, confidenceThreshold: 0.2 }),
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === "detect"),
      ).toHaveLength(1);
    });
    expect(
      worker.posted.find((message) => message.type === "detect"),
    ).toMatchObject({ confidenceThreshold: 0.5 });
  });
});

describe("visibility pause", () => {
  it("pauses the pump while hidden and resumes on return", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(
      <>
        <Probe />
        <StartOnReady />
      </>,
    );
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === "detect"),
      ).toHaveLength(1);
    });
    act(() => {
      setDocumentVisibility("hidden");
    });
    expect(screen.getByTestId("status").textContent).toBe("ready");
    // The in-flight frame's result lands while hidden: it must not re-prime
    // the stopped pump.
    act(() => {
      worker.emit({
        type: "detections",
        detections: [],
        timing: { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 },
      });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(1);
    // Returning to the foreground restarts the pump with the same video.
    act(() => {
      setDocumentVisibility("visible");
    });
    expect(screen.getByTestId("status").textContent).toBe("running");
    await waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === "detect"),
      ).toHaveLength(2);
    });
  });

  it("does not start the pump on a visibility bounce when never started", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<Probe />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      setDocumentVisibility("hidden");
    });
    act(() => {
      setDocumentVisibility("visible");
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("status").textContent).toBe("ready");
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(0);
  });
});

describe("settings pause", () => {
  it("pauses the pump while settings are open and resumes on close", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(
      <>
        <Probe />
        <StartOnReady />
        <SettingsToggle />
      </>,
    );
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === "detect"),
      ).toHaveLength(1);
    });
    act(() => {
      screen.getByTestId("open-settings").click();
    });
    expect(screen.getByTestId("status").textContent).toBe("ready");
    // The in-flight frame's result lands while paused: it must not re-prime
    // the stopped pump.
    act(() => {
      worker.emit({
        type: "detections",
        detections: [],
        timing: { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 },
      });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(1);
    // Closing the panel restarts the pump with the same video.
    act(() => {
      screen.getByTestId("close-settings").click();
    });
    expect(screen.getByTestId("status").textContent).toBe("running");
    await waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === "detect"),
      ).toHaveLength(2);
    });
  });

  it("does not start the pump on close when it was never started", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(
      <>
        <Probe />
        <SettingsToggle />
      </>,
    );
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("open-settings").click();
    });
    act(() => {
      screen.getByTestId("close-settings").click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("status").textContent).toBe("ready");
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(0);
  });
});

describe("crash sentinel heartbeat", () => {
  const readSentinel = (): Record<string, unknown> | null => {
    const raw = window.localStorage.getItem(SENTINEL_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  };

  it("writes a sentinel record once detection starts running", () => {
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    expect(readSentinel()).toBeNull();
    act(() => {
      screen.getByTestId("start").click();
    });
    expect(readSentinel()).toMatchObject({
      framesProcessed: 0,
      backend: "wasm",
      release: APP_RELEASE,
    });
  });

  it("resets a below-threshold crash streak when a session ends cleanly", () => {
    recordWebGpuCrash();
    expect(window.localStorage.getItem(SAFE_MODE_STORAGE_KEY)).not.toBeNull();
    const worker = renderWithProvider(<StartStop />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    act(() => {
      screen.getByTestId("stop").click();
    });
    expect(window.localStorage.getItem(SAFE_MODE_STORAGE_KEY)).toBeNull();
  });

  it("resets a below-threshold crash streak on pagehide", () => {
    recordWebGpuCrash();
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(window.localStorage.getItem(SAFE_MODE_STORAGE_KEY)).toBeNull();
  });

  it("keeps an armed safe mode across a clean session end", () => {
    armSafeMode();
    const worker = renderWithProvider(<StartStop />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    act(() => {
      screen.getByTestId("stop").click();
    });
    expect(window.localStorage.getItem(SAFE_MODE_STORAGE_KEY)).not.toBeNull();
  });

  it("clears the sentinel record when stop() leaves the running state", () => {
    const worker = renderWithProvider(<StartStop />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    expect(readSentinel()).not.toBeNull();
    act(() => {
      screen.getByTestId("stop").click();
    });
    expect(readSentinel()).toBeNull();
  });

  it("clears the sentinel record on pagehide so a reload is not read as a crash", () => {
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    expect(readSentinel()).not.toBeNull();
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(readSentinel()).toBeNull();
  });

  it("rewrites the sentinel on the next beat after a bfcache-style pagehide", async () => {
    vi.useFakeTimers();
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(readSentinel()).toBeNull();
    // The page came back from the bfcache instead of unloading: the interval
    // is still alive, so the next tick restores crash coverage.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    });
    expect(readSentinel()).not.toBeNull();
  });

  it("clears the sentinel record on unmount", () => {
    const worker = new FakeWorker();
    const { unmount } = render(
      <SettingsProvider>
        <DetectionProvider createWorker={() => worker}>
          <StartOnReady />
        </DetectionProvider>
      </SettingsProvider>,
    );
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    expect(readSentinel()).not.toBeNull();
    unmount();
    expect(readSentinel()).toBeNull();
  });

  it("does not write a sentinel record while only ready (not running)", () => {
    const worker = renderWithProvider(<Probe />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    expect(readSentinel()).toBeNull();
  });

  it("grows framesProcessed as detections results arrive between heartbeats", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    // The immediate heartbeat on entering "running" is written before any
    // detections result, so framesProcessed starts at 0.
    expect(readSentinel()).toMatchObject({ framesProcessed: 0 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => {
      worker.emit({
        type: "detections",
        detections: [],
        timing: { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 },
      });
    });
    // The next interval tick picks up the frame counted by the result above.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    });
    expect(readSentinel()).toMatchObject({ framesProcessed: 1 });
  });

  const backendProbe = () => ({
    workerGpu: false,
    adapter: false,
    device: false,
    shaderF16: false,
    graphCapture: false,
    chosen: "wasm" as const,
    safeMode: false,
    crossOriginIsolated: true,
    threads: 4,
  });

  it("does not reset startedAt or framesProcessed when a recycled worker re-reports its probe", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    // Capture the initial startedAt written when the running span began.
    const startedAt = readSentinel()?.startedAt;
    expect(startedAt).toEqual(expect.any(Number));
    // A frame result grows framesProcessed, and time advances so a restart of
    // the heartbeat effect would capture a later startedAt.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => {
      worker.emit({
        type: "detections",
        detections: [],
        timing: { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    });
    expect(readSentinel()).toMatchObject({ startedAt, framesProcessed: 1 });
    // A recycled worker re-reports its backend probe (fresh object identity).
    // The heartbeat effect must not tear down and restart: startedAt and the
    // frames baseline must survive.
    act(() => {
      worker.emit({ type: "backend-probe", probe: backendProbe() });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    });
    expect(readSentinel()).toMatchObject({ startedAt, framesProcessed: 1 });
  });
});

describe("worker recycle", () => {
  const emptyResult = {
    type: "detections" as const,
    detections: [],
    timing: { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 },
  };
  const detectCount = (worker: FakeWorker) =>
    worker.posted.filter((message) => message.type === "detect").length;

  /** Render with a createWorker spy that returns fresh fakes, exposing every
   * worker it hands out so the recycle can be observed. */
  const renderWithWorkerFactory = (ui: ReactNode) => {
    const workers: FakeWorker[] = [];
    render(
      <SettingsProvider>
        <DetectionProvider
          createWorker={() => {
            const worker = new FakeWorker();
            workers.push(worker);
            return worker;
          }}
        >
          {ui}
        </DetectionProvider>
      </SettingsProvider>,
    );
    return workers;
  };

  it("does not recycle a worker younger than the threshold", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const workers = renderWithWorkerFactory(<StartOnReady />);
    act(() => {
      workers[0].emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    // Age the worker to just under the threshold before the first frame posts,
    // so its round trip stays near zero (age is measured from creation at 0).
    now = WORKER_RECYCLE_AFTER_MS - 1;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(detectCount(workers[0])).toBe(1);
    // The result lands with the worker still under the recycle age.
    act(() => {
      workers[0].emit(emptyResult);
    });
    expect(workers).toHaveLength(1);
    expect(workers[0].terminate).not.toHaveBeenCalled();
    // The same worker is re-primed by the pacing timer, not recycled.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
    });
    expect(detectCount(workers[0])).toBe(2);
  });

  it("recycles a worker past the threshold and resumes the pump", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const workers = renderWithWorkerFactory(<StartOnReady />);
    act(() => {
      workers[0].emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(detectCount(workers[0])).toBe(1);
    // The worker crosses the recycle age; its next result triggers a recycle.
    now = WORKER_RECYCLE_AFTER_MS;
    act(() => {
      workers[0].emit(emptyResult);
    });
    // The old worker is terminated and a fresh one created and told to load.
    expect(workers).toHaveLength(2);
    expect(workers[0].terminate).toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(workers[1].posted).toContainEqual({
      type: "load",
      forceWasm: false,
    });
    // The old worker was mid-run at recycle, so no paced frame was scheduled on
    // it: the pump only resumes once the new worker reports ready.
    expect(detectCount(workers[1])).toBe(0);
    act(() => {
      workers[1].emit({ type: "ready", backend: "wasm" });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // Status never left "running", so the new worker's ready re-primes the pump.
    expect(screen.getByTestId("start").getAttribute("data-status")).toBe(
      "running",
    );
    expect(detectCount(workers[1])).toBe(1);
  });

  it("does not re-fire ready analytics on a recycled worker's ready", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const workers = renderWithWorkerFactory(<StartOnReady />);
    act(() => {
      workers[0].emit({ type: "model-load-start", fromCache: false });
      workers[0].emit({ type: "ready", backend: "webgpu" });
    });
    expect(track).toHaveBeenCalledWith("backend_resolved", {
      backend: "webgpu",
    });
    expect(track).toHaveBeenCalledWith("model_ready", {
      backend: "webgpu",
      fromCache: false,
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    now = WORKER_RECYCLE_AFTER_MS;
    act(() => {
      workers[0].emit(emptyResult);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // Only the recycled worker's ready is under test from here.
    vi.mocked(track).mockClear();
    act(() => {
      workers[1].emit({ type: "model-load-start", fromCache: true });
      workers[1].emit({ type: "ready", backend: "webgpu" });
    });
    expect(track).not.toHaveBeenCalledWith(
      "backend_resolved",
      expect.anything(),
    );
    expect(track).not.toHaveBeenCalledWith("model_ready", expect.anything());
  });

  it("leaves the pump stopped when stop lands between recycle and ready", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const workers = renderWithWorkerFactory(<StartStop />);
    act(() => {
      workers[0].emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(detectCount(workers[0])).toBe(1);
    now = WORKER_RECYCLE_AFTER_MS;
    act(() => {
      workers[0].emit(emptyResult);
    });
    expect(workers).toHaveLength(2);
    // The user stops before the recycled worker finishes loading.
    act(() => {
      screen.getByTestId("stop").click();
    });
    act(() => {
      workers[1].emit({ type: "ready", backend: "wasm" });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
    });
    // runningRef is false, so the new worker's ready must not re-prime the pump.
    expect(detectCount(workers[1])).toBe(0);
  });

  it("re-primes exactly once when stop then start land during the recycle-load window", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const workers = renderWithWorkerFactory(<StartStop />);
    act(() => {
      workers[0].emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(detectCount(workers[0])).toBe(1);
    // The worker crosses the recycle age; its next result recycles it, leaving
    // a fresh worker that has not reported ready yet.
    now = WORKER_RECYCLE_AFTER_MS;
    act(() => {
      workers[0].emit(emptyResult);
    });
    expect(workers).toHaveLength(2);
    // stop() then start() both land inside the recycle-load window (settings
    // open/close or a visibility bounce). start() sees statusRef "ready" and
    // calls sendFrame() directly, but the still-loading worker must not receive
    // a frame (it would silently drop it and strand the in-flight count).
    act(() => {
      screen.getByTestId("stop").click();
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(detectCount(workers[1])).toBe(0);
    // The new worker finishes loading: its ready re-primes the pump exactly
    // once (not zero: the pump would otherwise be dead; not two).
    act(() => {
      workers[1].emit({ type: "ready", backend: "wasm" });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(detectCount(workers[1])).toBe(1);
  });
});

describe("useDetection", () => {
  it("throws outside the provider", () => {
    const orphan = () => render(<Probe />);
    expect(orphan).toThrow(/DetectionProvider/);
  });
});

/** Minimal stand-in for ImageBitmap, which jsdom does not provide. */
class FakeImageBitmap {
  width = 320;
  height = 240;
  close = vi.fn();
}

const ContactProbe = () => {
  const { contact } = useDetection();
  return (
    <div>
      <span data-testid="contact-direction">
        {contact?.direction ?? "none"}
      </span>
      <span data-testid="contact-signal">{contact?.signal ?? "none"}</span>
      <span data-testid="contact-score">{contact?.score ?? "none"}</span>
      <span data-testid="contact-frame">{contact?.frame ? "yes" : "none"}</span>
    </div>
  );
};

describe("DetectionProvider contact", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const timing = { preprocessMs: 1, inferenceMs: 2, decodeMs: 3 };
  const policeDetection = (score: number, xmin: number, xmax: number) => ({
    label: "police",
    score,
    box: { xmin, ymin: 0.4, xmax, ymax: 0.6 },
  });

  it("exposes a contact built from the cropped detection", async () => {
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    const worker = new FakeWorker();
    render(
      <SettingsProvider>
        <DetectionProvider createWorker={() => worker}>
          <ContactProbe />
        </DetectionProvider>
      </SettingsProvider>,
    );
    // score 0.75 with SIGNAL_FLOOR 0.5 remaps to 0.5; center-x 0.2 is left.
    act(() => {
      worker.emit({
        type: "detections",
        detections: [policeDetection(0.75, 0.15, 0.25)],
        timing,
        crop: { image: new FakeImageBitmap(), detectionIndex: 0 },
      });
    });
    expect(screen.getByTestId("contact-direction")).toHaveTextContent("left");
    expect(screen.getByTestId("contact-signal")).toHaveTextContent("0.5");
    expect(screen.getByTestId("contact-score")).toHaveTextContent("0.75");
  });

  it("closes the previous contact's bitmap when a new crop arrives", () => {
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    const worker = new FakeWorker();
    const first = new FakeImageBitmap();
    render(
      <SettingsProvider>
        <DetectionProvider createWorker={() => worker}>
          <ContactProbe />
        </DetectionProvider>
      </SettingsProvider>,
    );
    act(() => {
      worker.emit({
        type: "detections",
        detections: [policeDetection(0.85, 0.15, 0.25)],
        timing,
        crop: { image: first, detectionIndex: 0 },
      });
    });
    act(() => {
      worker.emit({
        type: "detections",
        detections: [policeDetection(0.9, 0.45, 0.55)],
        timing,
        crop: { image: new FakeImageBitmap(), detectionIndex: 0 },
      });
    });
    expect(first.close).toHaveBeenCalled();
    expect(screen.getByTestId("contact-direction")).toHaveTextContent("ahead");
  });

  it("keeps the last contact through detection-free frames", () => {
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    const worker = new FakeWorker();
    render(
      <SettingsProvider>
        <DetectionProvider createWorker={() => worker}>
          <ContactProbe />
        </DetectionProvider>
      </SettingsProvider>,
    );
    act(() => {
      worker.emit({
        type: "detections",
        detections: [policeDetection(0.85, 0.15, 0.25)],
        timing,
        crop: { image: new FakeImageBitmap(), detectionIndex: 0 },
      });
    });
    act(() => {
      worker.emit({ type: "detections", detections: [], timing });
    });
    expect(screen.getByTestId("contact-direction")).toHaveTextContent("left");
  });

  it("discards a crop whose indexed detection fails validation", () => {
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    const worker = new FakeWorker();
    const orphan = new FakeImageBitmap();
    render(
      <SettingsProvider>
        <DetectionProvider createWorker={() => worker}>
          <ContactProbe />
        </DetectionProvider>
      </SettingsProvider>,
    );
    act(() => {
      worker.emit({
        type: "detections",
        detections: [policeDetection(0.85, 0.15, 0.25)],
        timing,
        crop: { image: orphan, detectionIndex: 5 },
      });
    });
    expect(orphan.close).toHaveBeenCalled();
    expect(screen.getByTestId("contact-direction")).toHaveTextContent("none");
  });

  it("clears the contact on a worker error", () => {
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    const worker = new FakeWorker();
    const image = new FakeImageBitmap();
    render(
      <SettingsProvider>
        <DetectionProvider createWorker={() => worker}>
          <ContactProbe />
        </DetectionProvider>
      </SettingsProvider>,
    );
    act(() => {
      worker.emit({
        type: "detections",
        detections: [policeDetection(0.85, 0.15, 0.25)],
        timing,
        crop: { image, detectionIndex: 0 },
      });
    });
    act(() => {
      worker.emit({ type: "worker-error", code: "INFERENCE_FAILED" });
    });
    expect(image.close).toHaveBeenCalled();
    expect(screen.getByTestId("contact-direction")).toHaveTextContent("none");
  });

  it("closes the contact bitmap on unmount", () => {
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    const worker = new FakeWorker();
    const image = new FakeImageBitmap();
    const { unmount } = render(
      <SettingsProvider>
        <DetectionProvider createWorker={() => worker}>
          <ContactProbe />
        </DetectionProvider>
      </SettingsProvider>,
    );
    act(() => {
      worker.emit({
        type: "detections",
        detections: [policeDetection(0.85, 0.15, 0.25)],
        timing,
        crop: { image, detectionIndex: 0 },
      });
    });
    unmount();
    expect(image.close).toHaveBeenCalled();
  });

  it("carries the saved-frame blob into the contact", () => {
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    const worker = new FakeWorker();
    render(
      <SettingsProvider>
        <DetectionProvider createWorker={() => worker}>
          <ContactProbe />
        </DetectionProvider>
      </SettingsProvider>,
    );
    act(() => {
      worker.emit({
        type: "detections",
        detections: [policeDetection(0.85, 0.15, 0.25)],
        timing,
        crop: { image: new FakeImageBitmap(), detectionIndex: 0 },
        frame: new Blob(["jpeg"], { type: "image/jpeg" }),
      });
    });
    expect(screen.getByTestId("contact-frame")).toHaveTextContent("yes");
  });

  it("exposes no frame when the response omits it", () => {
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    const worker = new FakeWorker();
    render(
      <SettingsProvider>
        <DetectionProvider createWorker={() => worker}>
          <ContactProbe />
        </DetectionProvider>
      </SettingsProvider>,
    );
    act(() => {
      worker.emit({
        type: "detections",
        detections: [policeDetection(0.85, 0.15, 0.25)],
        timing,
        crop: { image: new FakeImageBitmap(), detectionIndex: 0 },
      });
    });
    expect(screen.getByTestId("contact-direction")).toHaveTextContent("left");
    expect(screen.getByTestId("contact-frame")).toHaveTextContent("none");
  });

  it("shows no contact while the detection image is off", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ detectionImage: false }),
    );
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    const worker = new FakeWorker();
    const image = new FakeImageBitmap();
    render(
      <SettingsProvider>
        <DetectionProvider createWorker={() => worker}>
          <ContactProbe />
        </DetectionProvider>
      </SettingsProvider>,
    );
    act(() => {
      worker.emit({
        type: "detections",
        detections: [policeDetection(0.85, 0.15, 0.25)],
        timing,
        crop: { image, detectionIndex: 0 },
      });
    });
    expect(screen.getByTestId("contact-direction")).toHaveTextContent("none");
    expect(image.close).toHaveBeenCalled();
  });
});

/** Reads the auto-save publication the save toast renders. */
const SavedFrameProbe = () => {
  const { savedFrame } = useDetection();
  return (
    <div>
      <span data-testid="saved-filename">{savedFrame?.filename ?? "none"}</span>
      <span data-testid="saved-at">{savedFrame?.at ?? "none"}</span>
    </div>
  );
};

describe("DetectionProvider auto save", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const timing = { preprocessMs: 1, inferenceMs: 2, decodeMs: 3 };
  const policeDetection = (score: number) => ({
    label: "police",
    score,
    box: { xmin: 0.15, ymin: 0.4, xmax: 0.25, ymax: 0.6 },
  });
  const jpeg = () => new Blob(["jpeg"], { type: "image/jpeg" });

  const renderWithAutoSave = (enabled: boolean) => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true, autoSaveFrames: enabled }),
    );
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    const worker = new FakeWorker();
    render(
      <SettingsProvider>
        <DetectionProvider createWorker={() => worker}>
          <ContactProbe />
          <SavedFrameProbe />
        </DetectionProvider>
      </SettingsProvider>,
    );
    return worker;
  };

  it("downloads a detection's frame as it arrives", () => {
    const worker = renderWithAutoSave(true);
    const frame = jpeg();
    act(() => {
      worker.emit({
        type: "detections",
        detections: [policeDetection(0.85)],
        timing,
        crop: { image: new FakeImageBitmap(), detectionIndex: 0 },
        frame,
      });
    });
    expect(downloadBlob).toHaveBeenCalledWith(
      frame,
      expect.stringMatching(/^dashradar-frame-\d{4}-\d{2}-\d{2}-\d{6}\.jpg$/),
    );
  });

  // The whole point of auto save is collecting detections, not every scan. A
  // drive is mostly detection-free frames, so downloading those would bury the
  // detections and fill the device.
  it("never downloads a detection-free scan, even one carrying a frame", () => {
    const worker = renderWithAutoSave(true);
    act(() => {
      worker.emit({
        type: "detections",
        detections: [],
        timing,
        frameThumbnail: new FakeImageBitmap(),
        frame: jpeg(),
      });
    });
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("never downloads a crop whose detection fails the road filter", () => {
    const worker = renderWithAutoSave(true);
    act(() => {
      worker.emit({
        type: "detections",
        // Below the 0.5 confidence floor, so toRoadDetections drops it and the
        // crop is discarded rather than shown or saved.
        detections: [policeDetection(0.2)],
        timing,
        crop: { image: new FakeImageBitmap(), detectionIndex: 0 },
        frame: jpeg(),
      });
    });
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  // Hiding the card is a display choice; a collection drive that turned it off
  // to keep the glass clean must still get its files.
  it("still downloads with the detection image turned off", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        developerOptions: true,
        autoSaveFrames: true,
        detectionImage: false,
      }),
    );
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    const worker = new FakeWorker();
    render(
      <SettingsProvider>
        <DetectionProvider createWorker={() => worker}>
          <ContactProbe />
        </DetectionProvider>
      </SettingsProvider>,
    );
    const frame = jpeg();
    act(() => {
      worker.emit({
        type: "detections",
        detections: [policeDetection(0.85)],
        timing,
        crop: { image: new FakeImageBitmap(), detectionIndex: 0 },
        frame,
      });
    });
    expect(downloadBlob).toHaveBeenCalledWith(frame, expect.any(String));
    expect(screen.getByTestId("contact-direction")).toHaveTextContent("none");
  });

  it("downloads nothing while the setting is off", () => {
    const worker = renderWithAutoSave(false);
    act(() => {
      worker.emit({
        type: "detections",
        detections: [policeDetection(0.85)],
        timing,
        crop: { image: new FakeImageBitmap(), detectionIndex: 0 },
        frame: jpeg(),
      });
    });
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("downloads one file per detection across consecutive scans", () => {
    const worker = renderWithAutoSave(true);
    act(() => {
      worker.emit({
        type: "detections",
        detections: [policeDetection(0.85)],
        timing,
        crop: { image: new FakeImageBitmap(), detectionIndex: 0 },
        frame: jpeg(),
      });
    });
    act(() => {
      worker.emit({
        type: "detections",
        detections: [policeDetection(0.9)],
        timing,
        crop: { image: new FakeImageBitmap(), detectionIndex: 0 },
        frame: jpeg(),
      });
    });
    expect(vi.mocked(downloadBlob)).toHaveBeenCalledTimes(2);
  });

  // A download is invisible on a phone, so the save is published for the toast
  // that tells a collection drive it is actually writing files.
  it("publishes the saved frame under the name it was downloaded as", () => {
    const worker = renderWithAutoSave(true);
    act(() => {
      worker.emit({
        type: "detections",
        detections: [policeDetection(0.85)],
        timing,
        crop: { image: new FakeImageBitmap(), detectionIndex: 0 },
        frame: jpeg(),
      });
    });
    const [, filename] = vi.mocked(downloadBlob).mock.calls[0];
    expect(screen.getByTestId("saved-filename")).toHaveTextContent(filename);
  });

  // Consecutive saves land inside the same second, so the filename alone can
  // repeat; the toast re-shows off the fresh timestamp instead.
  it("publishes a distinct entry per save", () => {
    const worker = renderWithAutoSave(true);
    const scan = (score: number) => {
      act(() => {
        worker.emit({
          type: "detections",
          detections: [policeDetection(score)],
          timing,
          crop: { image: new FakeImageBitmap(), detectionIndex: 0 },
          frame: jpeg(),
        });
      });
      return screen.getByTestId("saved-at").textContent;
    };
    const first = scan(0.85);
    expect(scan(0.9)).not.toBe(first);
  });

  it("publishes nothing when a scan saves nothing", () => {
    const worker = renderWithAutoSave(false);
    act(() => {
      worker.emit({
        type: "detections",
        detections: [policeDetection(0.85)],
        timing,
        crop: { image: new FakeImageBitmap(), detectionIndex: 0 },
        frame: jpeg(),
      });
    });
    expect(screen.getByTestId("saved-filename")).toHaveTextContent("none");
  });
});

describe("DetectionProvider camera recovery", () => {
  // Real timers plus MIN_FRAME_INTERVAL_MS-scale sleeps would run these tests
  // past vitest's default 5 s test timeout (STALE_FRAME_THRESHOLD-plus rounds
  // at just over a second each). Fake timers keep them fast and deterministic
  // while exercising the exact same pump path as the real-timer paced-frame
  // tests above (presentFrame to flush the camera wait, then advance past
  // MIN_FRAME_INTERVAL_MS to fire the paced re-prime).
  it("recovers the camera after a run of identical frames", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const { video, presentFrame } = videoWithControlledFrames();
    const worker = renderWithProvider(<RecoveryProbe video={video} />);
    act(() => {
      worker.emit({ type: "ready", backend: "webgpu" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });

    expect(screen.getByTestId("camera-epoch").textContent).toBe("0");

    // Drive STALE_FRAME_THRESHOLD + 1 results all carrying the same fingerprint.
    // The first sets the baseline; each equal one after increments the streak.
    for (let i = 0; i <= STALE_FRAME_THRESHOLD; i += 1) {
      await act(async () => {
        presentFrame();
        await vi.advanceTimersByTimeAsync(0);
      });
      act(() => {
        emitDetections(worker, 42);
      });
      // Let the paced re-prime schedule the next frame.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
      });
    }

    expect(screen.getByTestId("camera-epoch").textContent).toBe("1");
    // The detected stall is reported to analytics, tagged as a frozen feed.
    expect(track).toHaveBeenCalledWith("camera_stall", { reason: "frozen" });
  });

  it("recovers the camera after a run of dark frames", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const { video, presentFrame } = videoWithControlledFrames();
    const worker = renderWithProvider(<RecoveryProbe video={video} />);
    act(() => {
      worker.emit({ type: "ready", backend: "webgpu" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });

    expect(screen.getByTestId("camera-epoch").textContent).toBe("0");

    // Distinct fingerprint each round (so the frozen detector never fires) but
    // brightFraction 0 (a fully dark feed), isolating the obscured detector.
    for (let i = 0; i <= OBSCURED_FRAME_THRESHOLD; i += 1) {
      await act(async () => {
        presentFrame();
        await vi.advanceTimersByTimeAsync(0);
      });
      act(() => {
        emitDetections(worker, i, 0);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
      });
    }

    expect(screen.getByTestId("camera-epoch").textContent).toBe("1");
    // The detected stall is reported to analytics, tagged as an obscured lens.
    expect(track).toHaveBeenCalledWith("camera_stall", { reason: "obscured" });
  });

  it("tags a byte-identical dark feed as frozen, not obscured", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const { video, presentFrame } = videoWithControlledFrames();
    const worker = renderWithProvider(<RecoveryProbe video={video} />);
    act(() => {
      worker.emit({ type: "ready", backend: "webgpu" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });

    // A solid-black frozen feed is both byte-identical AND dark, so the stale
    // and dark streaks reach their (equal) thresholds on the same frame. The
    // frozen check runs first, so it must win the reason tag.
    for (let i = 0; i <= STALE_FRAME_THRESHOLD; i += 1) {
      await act(async () => {
        presentFrame();
        await vi.advanceTimersByTimeAsync(0);
      });
      act(() => {
        emitDetections(worker, 42, 0);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
      });
    }

    expect(screen.getByTestId("camera-epoch").textContent).toBe("1");
    expect(track).toHaveBeenCalledWith("camera_stall", { reason: "frozen" });
    expect(track).not.toHaveBeenCalledWith("camera_stall", {
      reason: "obscured",
    });
  });

  it("does not recover when a bright frame interrupts the dark run", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const { video, presentFrame } = videoWithControlledFrames();
    const worker = renderWithProvider(<RecoveryProbe video={video} />);
    act(() => {
      worker.emit({ type: "ready", backend: "webgpu" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });

    for (let i = 0; i <= OBSCURED_FRAME_THRESHOLD + 2; i += 1) {
      await act(async () => {
        presentFrame();
        await vi.advanceTimersByTimeAsync(0);
      });
      act(() => {
        // A single bright frame (0.5) in the middle resets the streak; the dark
        // runs on either side of it (3 frames, then 4) each stay under
        // OBSCURED_FRAME_THRESHOLD, so the streak never reaches the threshold.
        emitDetections(worker, i, i === 3 ? 0.5 : 0);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
      });
    }

    expect(screen.getByTestId("camera-epoch").textContent).toBe("0");
    expect(track).not.toHaveBeenCalledWith("camera_stall", {
      reason: "obscured",
    });
  });

  it("does not recover while frames keep changing", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const { video, presentFrame } = videoWithControlledFrames();
    const worker = renderWithProvider(<RecoveryProbe video={video} />);
    act(() => {
      worker.emit({ type: "ready", backend: "webgpu" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });

    for (let i = 0; i <= STALE_FRAME_THRESHOLD + 2; i += 1) {
      await act(async () => {
        presentFrame();
        await vi.advanceTimersByTimeAsync(0);
      });
      act(() => {
        emitDetections(worker, i); // distinct fingerprint each round
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
      });
    }

    expect(screen.getByTestId("camera-epoch").textContent).toBe("0");
    // A healthy feed reports no stall.
    expect(track).not.toHaveBeenCalledWith("camera_stall", expect.anything());
  });

  it("clears the recovery guard when the fresh stream starts", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const { video, presentFrame } = videoWithControlledFrames();
    const worker = renderWithProvider(<RecoveryProbe video={video} />);
    act(() => {
      worker.emit({ type: "ready", backend: "webgpu" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    const driveStall = async (fingerprint: number) => {
      for (let i = 0; i <= STALE_FRAME_THRESHOLD; i += 1) {
        await act(async () => {
          presentFrame();
          await vi.advanceTimersByTimeAsync(0);
        });
        act(() => {
          emitDetections(worker, fingerprint);
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
        });
      }
    };
    await driveStall(7);
    expect(screen.getByTestId("camera-epoch").textContent).toBe("1");

    // Simulate CameraView remounting and delivering a fresh stream, then stall
    // it again: the second recovery only engages if start() released the
    // re-entrancy guard the first one took.
    act(() => {
      screen.getByTestId("start").click();
    });
    await driveStall(8);
    expect(screen.getByTestId("camera-epoch").textContent).toBe("2");
  });

  it("recovers when no result arrives within the watchdog window", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => fakeBitmap()),
    );
    const { video, presentFrame } = videoWithControlledFrames();
    const worker = renderWithProvider(<RecoveryProbe video={video} />);
    act(() => {
      worker.emit({ type: "ready", backend: "webgpu" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    // Present one frame so the pump posts and the watchdog is armed, but never
    // emit a result: the feed is fully stalled.
    await act(async () => {
      presentFrame();
      await Promise.resolve();
    });

    expect(screen.getByTestId("camera-epoch").textContent).toBe("0");
    act(() => {
      vi.advanceTimersByTime(WATCHDOG_MS + 50);
    });
    expect(screen.getByTestId("camera-epoch").textContent).toBe("1");
    // A full stall reports the same event, tagged as a watchdog trip.
    expect(track).toHaveBeenCalledWith("camera_stall", { reason: "watchdog" });
  });

  it("does not fire the watchdog after the pump is stopped", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => fakeBitmap()),
    );
    const { video, presentFrame } = videoWithControlledFrames();
    const worker = renderWithProvider(<RecoveryProbe video={video} />);
    act(() => {
      worker.emit({ type: "ready", backend: "webgpu" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await act(async () => {
      presentFrame();
      await Promise.resolve();
    });
    // Hide the page: the visibility handler stops the pump, which clears the
    // watchdog. Advancing past the window must not trigger recovery.
    act(() => {
      setDocumentVisibility("hidden");
    });
    act(() => {
      vi.advanceTimersByTime(WATCHDOG_MS + 50);
    });
    expect(screen.getByTestId("camera-epoch").textContent).toBe("0");
    // A stopped pump reports no stall.
    expect(track).not.toHaveBeenCalledWith("camera_stall", expect.anything());
  });

  /** Drive one frozen-feed stall: repeat an identical fingerprint to the
   *  threshold, tripping recovery. Does NOT resume the pump, so it exercises the
   *  terminal escalation (which stops the pump for good) as well as the remount
   *  path. */
  const driveFrozenStall = async (worker: FakeWorker, present: () => void) => {
    for (let i = 0; i <= STALE_FRAME_THRESHOLD; i += 1) {
      await act(async () => {
        present();
        await vi.advanceTimersByTimeAsync(0);
      });
      act(() => {
        emitDetections(worker, 99);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS + 20);
      });
    }
  };

  /** Drive one frozen-feed recovery: stall to the threshold, then simulate the
   *  remounted CameraView delivering a fresh stream that resumes the pump. */
  const driveFrozenRecovery = async (
    worker: FakeWorker,
    present: () => void,
  ) => {
    await driveFrozenStall(worker, present);
    // Fresh stream from the remount resumes the pump.
    act(() => {
      screen.getByTestId("start").click();
    });
  };

  it("shows the stalled alert after MAX_RECONNECT_ATTEMPTS failed recoveries", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => fakeBitmap()),
    );
    const { video, presentFrame } = videoWithControlledFrames();
    const worker = renderWithProvider(<RecoveryProbe video={video} />);
    act(() => {
      worker.emit({ type: "ready", backend: "webgpu" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });

    // Each frozen recovery re-stalls immediately (identical fingerprint again),
    // never reaching RECOVERY_HEALTHY_FRAMES healthy frames, so attempts stack.
    for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt += 1) {
      await driveFrozenRecovery(worker, presentFrame);
    }
    expect(screen.getByTestId("camera-stalled").textContent).toBe("false");

    // One more frozen stall: attempts now equal MAX, so recovery gives up and
    // surfaces the terminal alert instead of remounting, leaving cameraEpoch
    // where the third remount left it.
    await driveFrozenStall(worker, presentFrame);
    expect(screen.getByTestId("camera-stalled").textContent).toBe("true");
    expect(screen.getByTestId("camera-epoch").textContent).toBe(
      String(MAX_RECONNECT_ATTEMPTS),
    );

    // The unrecoverable stall is reported to analytics exactly once: it is the
    // only signal of a fleet-wide camera failure the old silent reload erased,
    // and the recovery re-entrancy guard must keep a further stall from
    // re-firing it. `track`'s other calls here are ready events, not "error".
    const stalledReports = vi
      .mocked(track)
      .mock.calls.filter(([event]) => event === "error");
    expect(stalledReports).toEqual([["error", { code: "CAMERA_STALLED" }]]);
  });

  /** Drive `count` pump rounds with a distinct (changing) fingerprint each
   *  round, simulating a healthy feed that grows the recovery's healthy-frame
   *  streak instead of its stale-frame streak. Mirrors driveFrozenRecovery's
   *  present -> emit -> advance cycle, but never calls start(): the pump is
   *  already running (resumed by a prior recovery), and a healthy run alone
   *  must not touch cameraEpoch. */
  const driveHealthyFrames = async (
    worker: FakeWorker,
    present: () => void,
    count: number,
  ) => {
    for (let i = 0; i < count; i += 1) {
      await act(async () => {
        present();
        await Promise.resolve();
      });
      act(() => {
        emitDetections(worker, 1_000 + i);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS + 20);
      });
    }
  };

  it("a healthy run resets the reconnect counter so a later stall does not give up", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => fakeBitmap()),
    );
    const { video, presentFrame } = videoWithControlledFrames();
    const worker = renderWithProvider(<RecoveryProbe video={video} />);
    act(() => {
      worker.emit({ type: "ready", backend: "webgpu" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });

    // Stack attempts to the brink of the terminal alert, exactly as the test
    // above.
    for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt += 1) {
      await driveFrozenRecovery(worker, presentFrame);
    }
    expect(screen.getByTestId("camera-stalled").textContent).toBe("false");

    // A healthy run on the resumed pump proves the feed recovered, resetting
    // the reconnect counter back to 0.
    await driveHealthyFrames(worker, presentFrame, RECOVERY_HEALTHY_FRAMES);

    // One more frozen run: without the reset, attempts would already equal MAX
    // and this stall would surface the terminal alert; the healthy run zeroed
    // the counter, so this recovery just remounts (bumping cameraEpoch) instead.
    await driveFrozenRecovery(worker, presentFrame);
    expect(screen.getByTestId("camera-stalled").textContent).toBe("false");
    // Confirms the final recovery actually engaged (rather than the alert being
    // skipped for some other reason): the first loop's 3 recoveries bump
    // cameraEpoch to 3, the healthy run leaves it untouched, and this last
    // recovery bumps it to 4.
    expect(screen.getByTestId("camera-epoch").textContent).toBe("4");
  });

  // Shared across every driveObscuredStall call in the file so fingerprints
  // never repeat, including across a chain of driveObscuredRecovery calls
  // within a single test: a noisy obscured lens must never trip the frozen
  // detector's identical-fingerprint check.
  let obscuredFingerprintCounter = 0;

  /** Drive one obscured-lens stall: repeat OBSCURED_FRAME_THRESHOLD + 1 dark
   *  (brightFraction 0) frames, each with a distinct, never-before-seen
   *  fingerprint so the frozen detector never fires, isolating the obscured
   *  detector. Does NOT resume the pump, so it exercises the terminal
   *  escalation (which stops the pump for good) as well as the remount path.
   *  Mirrors driveFrozenStall's present -> emit -> advance cycle. */
  const driveObscuredStall = async (
    worker: FakeWorker,
    present: () => void,
  ) => {
    for (let i = 0; i <= OBSCURED_FRAME_THRESHOLD; i += 1) {
      await act(async () => {
        present();
        await vi.advanceTimersByTimeAsync(0);
      });
      act(() => {
        obscuredFingerprintCounter += 1;
        emitDetections(worker, obscuredFingerprintCounter, 0);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS + 20);
      });
    }
  };

  /** Drive one obscured-lens recovery: stall to the threshold, then simulate
   *  the remounted CameraView delivering a fresh stream that resumes the
   *  pump. */
  const driveObscuredRecovery = async (
    worker: FakeWorker,
    present: () => void,
  ) => {
    await driveObscuredStall(worker, present);
    // Fresh stream from the remount resumes the pump.
    act(() => {
      screen.getByTestId("start").click();
    });
  };

  it("shows the stalled alert after MAX_RECONNECT_ATTEMPTS failed obscured recoveries", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => fakeBitmap()),
    );
    const { video, presentFrame } = videoWithControlledFrames();
    const worker = renderWithProvider(<RecoveryProbe video={video} />);
    act(() => {
      worker.emit({ type: "ready", backend: "webgpu" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });

    // Each obscured recovery re-stalls immediately (still dark, still
    // changing), never reaching RECOVERY_HEALTHY_FRAMES healthy frames since a
    // dark frame is never healthy, so attempts stack.
    for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt += 1) {
      await driveObscuredRecovery(worker, presentFrame);
    }
    expect(screen.getByTestId("camera-stalled").textContent).toBe("false");

    // One more obscured stall: attempts now equal MAX, so recovery gives up
    // and surfaces the terminal alert instead of remounting.
    await driveObscuredStall(worker, presentFrame);
    expect(screen.getByTestId("camera-stalled").textContent).toBe("true");
    expect(screen.getByTestId("camera-epoch").textContent).toBe(
      String(MAX_RECONNECT_ATTEMPTS),
    );

    // The unrecoverable stall is reported to analytics exactly once.
    const stalledReports = vi
      .mocked(track)
      .mock.calls.filter(([event]) => event === "error");
    expect(stalledReports).toEqual([["error", { code: "CAMERA_STALLED" }]]);
  });
});

describe("dev video mode", () => {
  // A file-backed feed legitimately pauses (no new frames) and repeats frames
  // (a scrubbed or looping clip), so the stall machinery must never fire.
  it("never fires the watchdog in dev video mode", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const { video, presentFrame } = videoWithControlledFrames();
    const worker = renderWithProvider(<RecoveryProbe video={video} />, {
      devVideoMode: true,
    });
    act(() => {
      worker.emit({ type: "ready", backend: "webgpu" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    // One frame reaches the worker, then no result ever comes back: exactly
    // what a paused dev video looks like to the pump.
    await act(async () => {
      presentFrame();
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WATCHDOG_MS * 2);
    });
    expect(screen.getByTestId("camera-stalled").textContent).toBe("false");
    expect(screen.getByTestId("camera-epoch").textContent).toBe("0");
    expect(track).not.toHaveBeenCalledWith("camera_stall", {
      reason: "watchdog",
    });
  });

  it("keeps scanning through identical dark frames in dev video mode", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const { video, presentFrame } = videoWithControlledFrames();
    const worker = renderWithProvider(<RecoveryProbe video={video} />, {
      devVideoMode: true,
    });
    act(() => {
      worker.emit({ type: "ready", backend: "webgpu" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    // Identical fingerprints AND zero brightness: past both thresholds, this
    // trips the frozen detector first outside dev video mode (see the
    // "tags a byte-identical dark feed as frozen" test above). Here neither
    // detector may fire, and the pump must keep re-priming (the disabled
    // stall branch must not skip the paced re-prime).
    for (let i = 0; i <= STALE_FRAME_THRESHOLD; i += 1) {
      await act(async () => {
        presentFrame();
        await vi.advanceTimersByTimeAsync(0);
      });
      act(() => {
        emitDetections(worker, 42, 0);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
      });
    }
    expect(screen.getByTestId("camera-epoch").textContent).toBe("0");
    expect(track).not.toHaveBeenCalledWith("camera_stall", expect.anything());
    // Every loop round posted a fresh detect frame: the pump stayed alive.
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(STALE_FRAME_THRESHOLD + 1);
  });
});
