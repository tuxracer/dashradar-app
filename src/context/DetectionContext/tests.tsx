import { track } from "@vercel/analytics";
import { act, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useState } from "react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DetectionProvider,
  FRAME_RETRY_MS,
  MIN_FRAME_INTERVAL_MS,
  POLICE_EVENT_DEBOUNCE_MS,
  useDetection,
  WORKER_RECYCLE_AFTER_MS,
} from "@/context/DetectionContext";
import {
  SettingsProvider,
  STORAGE_KEY,
  useSettings,
} from "@/context/SettingsContext";
import {
  HEARTBEAT_INTERVAL_MS,
  SENTINEL_STORAGE_KEY,
} from "@/lib/crashSentinel";

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));
import type {
  DebugSnapshot,
  DetectionWorkerLike,
} from "@/context/DetectionContext";
import type { MotionSensorManager } from "@/lib/motionSensor";
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
      <span data-testid="objects">{hud ? hud.blips.length : "none"}</span>
      <span data-testid="error">{error ?? "none"}</span>
    </div>
  );
};

// fps and the debug snapshot live in refs read through getFps()/
// getDebugSnapshot() (results must not re-render the app), so these probes
// read them on demand instead of rendering live state.
const FpsProbe = () => {
  const { getFps } = useDetection();
  const [fps, setFps] = useState<number>();
  return (
    <div>
      <button data-testid="read-fps" onClick={() => setFps(getFps())}>
        read fps
      </button>
      <span data-testid="fps">{fps ?? "none"}</span>
    </div>
  );
};

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

const MotionPermissionProbe = () => {
  const { motionPermission } = useDetection();
  return <span data-testid="motion-permission">{motionPermission}</span>;
};

const DeltaProbe = () => {
  const { getMotionDelta } = useDetection();
  const [yaw, setYaw] = useState<number | undefined>(undefined);
  return (
    <div>
      <button
        data-testid="read-delta"
        onClick={() => setYaw(getMotionDelta().yaw)}
      >
        read delta
      </button>
      <span data-testid="delta-yaw">{yaw ?? "none"}</span>
    </div>
  );
};

const renderWithProvider = (ui: ReactNode) => {
  const worker = new FakeWorker();
  render(
    <SettingsProvider>
      <DetectionProvider createWorker={() => worker}>{ui}</DetectionProvider>
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
  // Restore the prototype visibilityState getter shadowed by
  // setDocumentVisibility, so later tests see jsdom's real value.
  Reflect.deleteProperty(document, "visibilityState");
  // A seeded showDebug (or any other persisted setting) must not leak between
  // tests: SettingsProvider persists its state to localStorage on mount.
  window.localStorage.clear();
});

describe("DetectionProvider", () => {
  it("starts loading the model on mount", async () => {
    const worker = renderWithProvider(<Probe />);
    expect(screen.getByTestId("status").textContent).toBe("loading-model");
    // The load message is deferred to a microtask (Promise.resolve in tests),
    // so wait for it rather than asserting synchronously.
    await waitFor(() => {
      expect(worker.posted).toContainEqual({ type: "load" });
    });
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
    // Simulate a slow device: the result lands 1000 ms after the frame was
    // posted, well past the pacing floor.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    act(() => {
      worker.emit({
        type: "detections",
        detections: [],
        timing: { preprocessMs: 5, inferenceMs: 990, decodeMs: 5 },
      });
    });
    // The pump must not re-prime immediately: it rests PACING_REST_RATIO of
    // the round trip (500 ms here), so 400 ms in nothing new is posted.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
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
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("police_detected");

    // A second sighting within the debounce window is the same encounter.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    act(() => {
      worker.emit({ type: "detections", detections: [police], timing });
    });
    expect(track).toHaveBeenCalledTimes(1);

    // After police are absent past the debounce window, a sighting re-fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLICE_EVENT_DEBOUNCE_MS);
    });
    act(() => {
      worker.emit({ type: "detections", detections: [police], timing });
    });
    expect(track).toHaveBeenCalledTimes(2);
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
    // Ready emits backend_resolved/model_ready; only the police event is under
    // test here, so drop those before emitting the empty detections frame.
    vi.mocked(track).mockClear();
    act(() => {
      worker.emit({
        type: "detections",
        detections: [],
        timing: { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 },
      });
    });
    expect(track).not.toHaveBeenCalled();
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

  it("exposes a finite fps after multiple detection results", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(
      <>
        <FpsProbe />
        <StartOnReady />
      </>,
    );
    act(() => {
      worker.emit({ type: "ready", backend: "wasm" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    for (let result = 0; result < 2; result += 1) {
      // The first frame posts on a microtask; later frames wait out pacing.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          result === 0 ? 0 : MIN_FRAME_INTERVAL_MS,
        );
      });
      expect(
        worker.posted.filter((message) => message.type === "detect"),
      ).toHaveLength(result + 1);
      act(() => {
        worker.emit({
          type: "detections",
          detections: [],
          timing: { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 },
        });
      });
    }
    act(() => {
      screen.getByTestId("read-fps").click();
    });
    const fps = Number(screen.getByTestId("fps").textContent);
    expect(Number.isFinite(fps)).toBe(true);
    expect(fps).toBeGreaterThanOrEqual(0);
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

  it("posts includeFrame false while the debug setting is off", async () => {
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
    ).toMatchObject({ includeFrame: false });
  });

  it("posts includeFrame true while the debug setting is on", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showDebug: true }),
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
    });
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
    expect(workers[1].posted).toContainEqual({ type: "load" });
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

describe("motion compensation", () => {
  it("measures the motion delta from the pose at the last result", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const orientation = { yaw: 0, pitch: 0 };
    const manager: MotionSensorManager = {
      start: () => {},
      stop: () => {},
      getYawPitch: () => orientation, // live object, mutated after capture below
      getPermission: () => "granted",
      requestPermission: () => Promise.resolve("granted"),
    };
    const worker = new FakeWorker();
    render(
      <SettingsProvider>
        <DetectionProvider
          createWorker={() => worker}
          createMotionManager={() => manager}
        >
          <DeltaProbe />
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
    await waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === "detect"),
      ).toHaveLength(1);
    });
    // Result lands while the camera pose is still yaw 0, so the reference is 0.
    act(() => {
      worker.emit({
        type: "detections",
        detections: [],
        timing: { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 },
      });
    });
    // The phone then rotates. Delta must be measured from the captured
    // reference, which requires the context to have snapshotted a COPY at
    // capture time.
    orientation.yaw = 0.2;
    act(() => {
      screen.getByTestId("read-delta").click();
    });
    expect(Number(screen.getByTestId("delta-yaw").textContent)).toBeCloseTo(
      0.2,
    );
  });

  it("initializes motionPermission from the manager", () => {
    const manager: MotionSensorManager = {
      start: () => {},
      stop: () => {},
      getYawPitch: () => ({ yaw: 0, pitch: 0 }),
      getPermission: () => "prompt",
      requestPermission: () => Promise.resolve("granted"),
    };
    const worker = new FakeWorker();
    render(
      <SettingsProvider>
        <DetectionProvider
          createWorker={() => worker}
          createMotionManager={() => manager}
        >
          <MotionPermissionProbe />
        </DetectionProvider>
      </SettingsProvider>,
    );
    expect(screen.getByTestId("motion-permission").textContent).toBe("prompt");
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
    // score 0.85 with SIGNAL_FLOOR 0.7 remaps to 0.5; center-x 0.2 is left.
    act(() => {
      worker.emit({
        type: "detections",
        detections: [policeDetection(0.85, 0.15, 0.25)],
        timing,
        crop: { image: new FakeImageBitmap(), detectionIndex: 0 },
      });
    });
    expect(screen.getByTestId("contact-direction")).toHaveTextContent("left");
    expect(screen.getByTestId("contact-signal")).toHaveTextContent("0.5");
    expect(screen.getByTestId("contact-score")).toHaveTextContent("0.85");
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

  it("carries the full-frame blob into the contact", () => {
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
});
