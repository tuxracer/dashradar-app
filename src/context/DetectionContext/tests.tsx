import { track } from "@vercel/analytics";
import { act, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useState } from "react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DetectionProvider,
  FRAME_RETRY_MS,
  MIN_FRAME_INTERVAL_MS,
  useDetection,
  WORKER_RECYCLE_AFTER_MS,
} from "@/context/DetectionContext";
import { pacingDelay } from "@/lib/detectionEngine";

import {
  DEVELOPER_OPTIONS_OFF,
  SETTINGS_VERSION,
  SettingsProvider,
  STORAGE_KEY,
  useSettings,
} from "@/context/SettingsContext";
import { DEFAULT_MODEL, STORED_MODELS_KEY } from "@/lib/detectionModels";
import {
  LATE_TIMING_AFTER_MS,
  readTimingHistory,
  TIMING_HISTORY_LIMIT,
} from "@/lib/timingHistory";
import { INPUT_SIZE, ZOOM_2X, ZOOM_OFF } from "@/workers/detection/consts";

/** Id of the extra stored model seeded for the tests that need a second
 * selectable model to exist. */
const SECOND_MODEL_ID = "second-model";

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));
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
  const { status, downloadingModel, modelProgress, hud, error } =
    useDetection();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="downloading">{String(downloadingModel)}</span>
      <span data-testid="loaded">{modelProgress.loadedBytes}</span>
      <span data-testid="objects">{hud ? (hud.top ? 1 : 0) : "none"}</span>
      <span data-testid="error">{error ?? "none"}</span>
    </div>
  );
};

const ScanProbe = () => {
  const { scan } = useDetection();
  return (
    <div>
      <span data-testid="scan-count">{scan?.detections.length ?? "none"}</span>
      <span data-testid="scan-zoom">{scan?.zoom ?? "none"}</span>
      <span data-testid="scan-width">{scan?.frame.width ?? "none"}</span>
    </div>
  );
};

/** Renders each published track as `id@xmin`, so a test can tell which box an
 * id is attached to across results. */
const TrackProbe = () => {
  const { scan } = useDetection();
  return (
    <span data-testid="track-ids">
      {scan
        ? scan.tracks
            .map((scanTrack) => `${scanTrack.id}@${scanTrack.box.xmin}`)
            .join(" ")
        : "none"}
    </span>
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
      <span data-testid="capture-failures">
        {debug?.captureFailures ?? "none"}
      </span>
    </div>
  );
};

const StartOnReady = () => {
  const { status, attachVideo: start } = useDetection();
  return (
    <button
      onClick={() => start(fakeVideo())}
      data-testid="start"
      data-status={status}
    >
      start
    </button>
  );
};

const StartStop = () => {
  const { attachVideo: start, detachVideo: stop } = useDetection();
  return (
    <>
      <button onClick={() => start(fakeVideo())} data-testid="start">
        start
      </button>
      <button onClick={() => stop()} data-testid="stop">
        stop
      </button>
    </>
  );
};

const StartStopWithVideo = ({ video }: { video: HTMLVideoElement }) => {
  const { attachVideo: start, detachVideo: stop } = useDetection();
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

/** Flips the Developer options master switch, which changes the effective
 * value of every developer option, the model selection among them. */
const DeveloperOptionsToggle = () => {
  const { toggleDeveloperOptions } = useSettings();
  return (
    <button data-testid="toggle-developer" onClick={toggleDeveloperOptions}>
      developer options
    </button>
  );
};

const renderWithProvider = (ui: ReactNode, deferModelLoad = false) => {
  const worker = new FakeWorker();
  render(
    <SettingsProvider>
      <DetectionProvider
        createWorker={() => worker}
        deferModelLoad={deferModelLoad}
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
 * A video element that reports an intrinsic size, the way a playing camera
 * stream does. The engine reads these to decide the region it captures and to
 * tell a result which frame its boxes belong to, so jsdom's zero-sized default
 * would leave both untested.
 */
const fakeVideo = (width = 1280, height = 720): HTMLVideoElement => {
  const video = document.createElement("video");
  Object.defineProperty(video, "videoWidth", { value: width });
  Object.defineProperty(video, "videoHeight", { value: height });
  return video;
};

/**
 * A video element whose requestVideoFrameCallback is under test control:
 * callbacks queue up until presentFrame() fires them, simulating the camera
 * presenting a new frame. jsdom's video element has no rVFC of its own, so
 * assigning one exercises the pump's wait-for-new-frame path.
 */
const videoWithControlledFrames = () => {
  const callbacks: VideoFrameRequestCallback[] = [];
  const video = fakeVideo();
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

/**
 * Run `count` scans through the pump, each reporting a one-second inference.
 */
const runScans = async (
  worker: FakeWorker,
  presentFrame: () => void,
  count: number,
) => {
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
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
    });
  }
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
  // jsdom implements no Wake Lock API; drop any stub so the tests that don't
  // install one see the unsupported platform they expect.
  Reflect.deleteProperty(navigator, "wakeLock");
  // A seeded showDebug (or any other persisted setting) must not leak between
  // tests: SettingsProvider persists its state to localStorage on mount.
  window.localStorage.clear();
  // Every detection result appends to the rolling timing window.
  window.sessionStorage.clear();
});

describe("DetectionProvider", () => {
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
      worker.emit({ type: "ready" });
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

  it("hears a result that arrives synchronously with the post", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    // A worker that answers before postMessage returns: legal for a worker
    // shim, and the worst-case scheduling for the pump's reply listener. The
    // pump must have that listener in place at post time, not attach it a
    // tick later, or this reply lands on nothing and the pump stalls.
    const worker = new FakeWorker();
    const post = worker.postMessage.bind(worker);
    worker.postMessage = (message: WorkerRequest) => {
      post(message);
      if (message.type === "detect") {
        worker.emit({
          type: "detections",
          detections: [],
          timing: { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 },
        });
      }
    };
    render(
      <SettingsProvider>
        <DetectionProvider createWorker={() => worker}>
          <StartOnReady />
        </DetectionProvider>
      </SettingsProvider>,
    );
    act(() => {
      worker.emit({ type: "ready" });
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
    // The synchronous reply was heard, so pacing is already scheduled and
    // the next frame goes out on time instead of never.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
    });
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(2);
  });

  it("publishes each scan's own detections with the frame they came from", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(
      <>
        <ScanProbe />
        <StartOnReady />
      </>,
    );
    act(() => {
      worker.emit({ type: "ready" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("scan-count").textContent).toBe("none");
    act(() => {
      worker.emit({
        type: "detections",
        detections: [
          {
            label: "police",
            score: 0.9,
            box: { xmin: 0.4, ymin: 0.5, xmax: 0.6, ymax: 0.8 },
          },
          {
            label: "police",
            score: 0.2,
            box: { xmin: 0.1, ymin: 0.1, xmax: 0.2, ymax: 0.2 },
          },
        ],
        timing: { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 },
      });
    });
    // The confidence filter runs before publication, so the low-score
    // detection never reaches the overlay, and the frame geometry is the
    // captured bitmap's own.
    expect(screen.getByTestId("scan-count").textContent).toBe("1");
    expect(screen.getByTestId("scan-width").textContent).toBe("1280");
    expect(screen.getByTestId("scan-zoom").textContent).toBe(String(ZOOM_OFF));
  });

  it("drops a scan's boxes as soon as the model stops seeing them", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(
      <>
        <Probe />
        <ScanProbe />
        <StartOnReady />
      </>,
    );
    act(() => {
      worker.emit({ type: "ready" });
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
    });
    act(() => {
      worker.emit({
        type: "detections",
        detections: [],
        timing: { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 },
      });
    });
    // The tracker coasts the lost car, so the HUD still shows it; the scan is
    // raw per-frame output, so its box is gone the moment the model loses it.
    expect(screen.getByTestId("objects").textContent).toBe("1");
    expect(screen.getByTestId("scan-count").textContent).toBe("0");
  });

  it("publishes tracks whose id stays with the same box across results", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(
      <>
        <TrackProbe />
        <StartOnReady />
      </>,
    );
    act(() => {
      worker.emit({ type: "ready" });
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
    expect(screen.getByTestId("track-ids").textContent).toBe("0@0.4");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIN_FRAME_INTERVAL_MS);
    });
    // The next result sees the same object drifted slightly (an IoU match)
    // plus a brand-new one across the frame: the drifted box keeps id 0, the
    // newcomer gets its own id.
    act(() => {
      worker.emit({
        type: "detections",
        detections: [
          {
            label: "police",
            score: 0.9,
            box: { xmin: 0.42, ymin: 0.52, xmax: 0.62, ymax: 0.82 },
          },
          {
            label: "police",
            score: 0.9,
            box: { xmin: 0.05, ymin: 0.05, xmax: 0.15, ymax: 0.15 },
          },
        ],
        timing: { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 },
      });
    });
    expect(screen.getByTestId("track-ids").textContent).toBe("0@0.42 1@0.05");
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
      worker.emit({ type: "ready" });
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

  it("counts consecutive capture failures and clears the streak on success", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("video has no frame data"))
        .mockRejectedValueOnce(new Error("video has no frame data"))
        .mockImplementation(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(
      <>
        <DebugProbe />
        <StartOnReady />
      </>,
    );
    act(() => {
      worker.emit({ type: "ready" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    // Two captures fail back to back; the streak is visible mid-retry.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FRAME_RETRY_MS);
    });
    act(() => {
      screen.getByTestId("read-debug").click();
    });
    expect(screen.getByTestId("capture-failures").textContent).toBe("2");
    // The third capture succeeds and posts, ending the streak.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FRAME_RETRY_MS);
    });
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(1);
    act(() => {
      screen.getByTestId("read-debug").click();
    });
    expect(screen.getByTestId("capture-failures").textContent).toBe("0");
  });

  it("paces the next frame to the minimum interval after a fast result", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready" });
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
      worker.emit({ type: "ready" });
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
    // Simulate a slow device: the result lands well past the pacing floor, so
    // the proportional rest governs instead. The expected wait comes from the
    // pacing rule itself (unit-tested in src/lib/detectionEngine) rather than
    // being restated here, so this test covers the pump honoring the decision
    // and does not have to be edited every time the rule is retuned.
    const roundTripMs = 1_000;
    const restMs = pacingDelay(roundTripMs).delayMs;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(roundTripMs);
    });
    act(() => {
      worker.emit({
        type: "detections",
        detections: [],
        timing: { preprocessMs: 5, inferenceMs: 990, decodeMs: 5 },
      });
    });
    // The pump must not re-prime immediately: it rests out the decision, so
    // just short of it nothing new is posted.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(restMs - 100);
    });
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(1);
    // Once the rest elapses, exactly one more frame goes out.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(
      worker.posted.filter((message) => message.type === "detect"),
    ).toHaveLength(2);
  });

  it("does not pump a paced frame scheduled before stop()", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartStop />);
    act(() => {
      worker.emit({ type: "ready" });
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
      worker.emit({ type: "ready" });
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
      worker.emit({ type: "ready" });
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
      worker.emit({ type: "ready" });
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
      worker.emit({ type: "ready" });
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
      worker.emit({ type: "ready" });
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
      worker.emit({ type: "ready" });
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
      worker.emit({ type: "ready" });
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
      worker.emit({ type: "ready" });
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
    expect(track).toHaveBeenCalledWith("first_inference", { seconds: 2.5 });
    expect(track).toHaveBeenCalledWith("first_round_trip", { seconds: 4 });
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
      worker.emit({ type: "ready" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });

    const timingEvents = () =>
      vi
        .mocked(track)
        .mock.calls.filter(([event]) => event.startsWith("timing_"));

    // A partial window reports nothing: a median of a couple of readings is
    // not worth an event.
    await runScans(worker, presentFrame, TIMING_HISTORY_LIMIT - 1);
    expect(timingEvents()).toHaveLength(0);

    // The next scan fills the window and reports both medians.
    await runScans(worker, presentFrame, 1);
    expect(timingEvents()).toEqual([
      ["timing_round_trip", { seconds: expect.any(Number) }],
      ["timing_inference", { seconds: 1 }],
    ]);

    // The drive keeps scanning, and the window keeps rolling; neither event
    // may fire a second time.
    await runScans(worker, presentFrame, TIMING_HISTORY_LIMIT);
    expect(timingEvents()).toHaveLength(2);
  });

  it("reports the medians a second time once the drive has scanned long enough", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const { video, presentFrame } = videoWithControlledFrames();
    const worker = renderWithProvider(<StartStopWithVideo video={video} />);
    act(() => {
      worker.emit({ type: "ready" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    const lateEvents = () =>
      vi.mocked(track).mock.calls.filter(([event]) => event.endsWith("_late"));

    // The early report fires here; the late one is not due on scan count.
    await runScans(worker, presentFrame, TIMING_HISTORY_LIMIT);
    expect(lateEvents()).toHaveLength(0);

    // A quarter hour of scanning later, the same rolling window reports again,
    // which is the pair of readings that shows thermal drift.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LATE_TIMING_AFTER_MS);
    });
    await runScans(worker, presentFrame, 1);
    expect(lateEvents()).toEqual([
      ["timing_round_trip_late", { seconds: expect.any(Number) }],
      ["timing_inference_late", { seconds: 1 }],
    ]);

    // Still once per session, however much longer the drive runs.
    await runScans(worker, presentFrame, TIMING_HISTORY_LIMIT);
    expect(lateEvents()).toHaveLength(2);
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
      worker.emit({ type: "ready" });
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
      worker.emit({ type: "ready" });
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
      worker.emit({ type: "ready" });
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
      worker.emit({ type: "ready" });
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
      worker.emit({ type: "ready" });
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
      worker.emit({ type: "ready" });
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
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ detectionImage: true }),
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready" });
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

  // With no cutout to cut, the full-resolution frame has no consumer, so the
  // capture asks for the model's input directly instead of handing the worker
  // four times the pixels to shrink itself.
  it("captures only the model's input while the detection image is off", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ detectionImage: false }),
    );
    const capture = vi.fn(() => Promise.resolve(fakeBitmap()));
    vi.stubGlobal("createImageBitmap", capture);
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === "detect"),
      ).toHaveLength(1);
    });
    // The centered square of a 1280x720 frame, resized to the model's input.
    expect(capture).toHaveBeenCalledWith(
      expect.anything(),
      280,
      0,
      720,
      720,
      expect.objectContaining({
        resizeWidth: INPUT_SIZE,
        resizeHeight: INPUT_SIZE,
      }),
    );
    // The worker is told which frame the crop came from, so the boxes it maps
    // back out still describe the whole frame rather than the crop.
    expect(
      worker.posted.find((message) => message.type === "detect"),
    ).toMatchObject({ source: { width: 1280, height: 720 } });
  });

  it("captures the whole frame while the detection image is on", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ detectionImage: true }),
    );
    const capture = vi.fn(() => Promise.resolve(fakeBitmap()));
    vi.stubGlobal("createImageBitmap", capture);
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === "detect"),
      ).toHaveLength(1);
    });
    // The cutout is cut from the frame's own pixels, so nothing may be cropped
    // or thrown away before the worker sees it, and the worker must be left to
    // do the cropping itself.
    expect(capture).toHaveBeenCalledWith(expect.anything());
    expect(
      worker.posted.find((message) => message.type === "detect")?.source,
    ).toBeUndefined();
  });

  it("captures the region the zoom it declares selects", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        detectionImage: false,
        developerOptions: true,
        zoomMode: "2x",
      }),
    );
    const capture = vi.fn(() => Promise.resolve(fakeBitmap()));
    vi.stubGlobal("createImageBitmap", capture);
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === "detect"),
      ).toHaveLength(1);
    });
    const posted = worker.posted.find((message) => message.type === "detect");
    expect(posted).toMatchObject({ zoom: ZOOM_2X });
    // Half the short edge, centered: the crop the declared zoom describes. A
    // capture cropped at one zoom and labelled with another would have the
    // worker map every box back through the wrong region.
    expect(capture).toHaveBeenCalledWith(
      expect.anything(),
      460,
      180,
      360,
      360,
      expect.anything(),
    );
  });

  it("posts the unzoomed crop factor by default", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready" });
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
      worker.emit({ type: "ready" });
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
    // The zoom is a developer override gated on the master switch: with it
    // off, a stored 2x must not pin the scan, so the first frame posts
    // ZOOM_OFF (not the stored ZOOM_2X).
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
      worker.emit({ type: "ready" });
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

  it("posts the production confidence floor by default", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartOnReady />);
    act(() => {
      worker.emit({ type: "ready" });
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
    ).toMatchObject({
      confidenceThreshold: DEVELOPER_OPTIONS_OFF.confidenceThreshold,
    });
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
      worker.emit({ type: "ready" });
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

  it("posts the production confidence floor when a stored override exists but developer options are off", async () => {
    // Gated on the Developer options master switch: a stored override must NOT
    // take effect while developerOptions is off, so normal use always filters
    // at the production floor.
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
      worker.emit({ type: "ready" });
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
    ).toMatchObject({
      confidenceThreshold: DEVELOPER_OPTIONS_OFF.confidenceThreshold,
    });
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
      worker.emit({ type: "ready" });
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
      worker.emit({ type: "ready" });
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
      worker.emit({ type: "ready" });
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
      worker.emit({ type: "ready" });
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

  it("leaves the pump paused when a feed arrives while settings are open", async () => {
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
      worker.emit({ type: "ready" });
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
    // A feed swap while the panel is open (e.g. picking a video file mid-scan)
    // must not resume the pump behind it: it should defer, leaving the panel's
    // own close effect to start the pump against the newly swapped element.
    act(() => {
      screen.getByTestId("start").click();
    });
    expect(screen.getByTestId("status").textContent).toBe("ready");
    // Closing the panel is what actually starts the pump.
    act(() => {
      screen.getByTestId("close-settings").click();
    });
    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("running");
    });
  });
});

describe("scan session reporting", () => {
  const MINUTE = 60_000;

  /** Mount with the pump running. */
  const startScanning = async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    const worker = renderWithProvider(<StartStop />);
    act(() => {
      worker.emit({ type: "ready" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    return worker;
  };

  const scanSessions = () =>
    vi.mocked(track).mock.calls.filter(([name]) => name === "scan_session");

  const advance = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  it("reports how long the drive scanned when the page goes hidden", async () => {
    await startScanning();
    await advance(10 * MINUTE);
    act(() => {
      setDocumentVisibility("hidden");
    });
    expect(scanSessions()).toEqual([
      ["scan_session", { minutes: 10, standalone: false }],
    ]);
  });

  it("reports on an unload that no hidden event preceded", async () => {
    await startScanning();
    await advance(5 * MINUTE);
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(scanSessions()).toEqual([
      ["scan_session", { minutes: 5, standalone: false }],
    ]);
  });

  // The two listeners fire in sequence on an ordinary close: backgrounded,
  // then unloaded. Draining the clock is what keeps that one drive from being
  // counted as two.
  it("does not count the same stretch again when the page then unloads", async () => {
    await startScanning();
    await advance(5 * MINUTE);
    act(() => {
      setDocumentVisibility("hidden");
    });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(scanSessions()).toHaveLength(1);
  });

  it("counts nothing for a session that never scanned", async () => {
    vi.useFakeTimers();
    renderWithProvider(<StartStop />);
    await advance(30 * MINUTE);
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(scanSessions()).toEqual([]);
  });

  // Time on the settings panel or with the app in the background is not time
  // the detector watched the road.
  it("leaves out the time the pump was stopped", async () => {
    await startScanning();
    await advance(10 * MINUTE);
    act(() => {
      screen.getByTestId("stop").click();
    });
    await advance(60 * MINUTE);
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(scanSessions()).toEqual([
      ["scan_session", { minutes: 10, standalone: false }],
    ]);
  });

  // An interruption mid-drive (a call, a glance at another app) must not cost
  // the rest of the drive: the stretch after it is its own report.
  it("reports the stretch after an interruption too", async () => {
    await startScanning();
    await advance(2 * MINUTE);
    act(() => {
      setDocumentVisibility("hidden");
    });
    await advance(10 * MINUTE);
    act(() => {
      setDocumentVisibility("visible");
    });
    await advance(30 * MINUTE);
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(scanSessions()).toEqual([
      ["scan_session", { minutes: 2, standalone: false }],
      ["scan_session", { minutes: 30, standalone: false }],
    ]);
  });
});

describe("worker recycle", () => {
  const emptyResult = {
    type: "detections" as const,
    detections: [],
    timing: { preprocessMs: 0, inferenceMs: 0, decodeMs: 0 },
  };

  /** Render with a createWorker spy that returns fresh fakes, exposing every
   * worker it hands out so the recycle can be observed. */
  const renderWithWorkerFactory = (ui: ReactNode, deferModelLoad = false) => {
    const workers: FakeWorker[] = [];
    render(
      <SettingsProvider>
        <DetectionProvider
          createWorker={() => {
            const worker = new FakeWorker();
            workers.push(worker);
            return worker;
          }}
          deferModelLoad={deferModelLoad}
        >
          {ui}
        </DetectionProvider>
      </SettingsProvider>,
    );
    return workers;
  };

  it("keeps a recycled worker on the model the session started with", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.resolve(fakeBitmap())),
    );
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        settingsVersion: SETTINGS_VERSION,
        developerOptions: true,
        modelIds: [SECOND_MODEL_ID],
      }),
    );
    // Seed the real stored-model mechanism with a second selectable entry (a
    // copy of the shipping model under another id), so the selection above
    // resolves to something other than DEFAULT_MODEL.
    window.localStorage.setItem(
      STORED_MODELS_KEY,
      JSON.stringify([{ ...DEFAULT_MODEL, id: SECOND_MODEL_ID }]),
    );
    const workers = renderWithWorkerFactory(
      <>
        <StartOnReady />
        <DeveloperOptionsToggle />
      </>,
    );
    act(() => {
      workers[0].emit({ type: "ready" });
    });
    act(() => {
      screen.getByTestId("start").click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // The selection changes underneath the running session: turning Developer
    // options off takes the effective value back to the shipping model. A model
    // change applies on the reload the model screen performs, and a recycle is
    // not one, so the fresh worker has to load what the session started on.
    act(() => {
      screen.getByTestId("toggle-developer").click();
    });
    now = WORKER_RECYCLE_AFTER_MS;
    act(() => {
      workers[0].emit(emptyResult);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const loadMessage = workers[1].posted.find(
      (message) => message.type === "load",
    );
    expect(loadMessage).toMatchObject({
      type: "load",
      model: { id: SECOND_MODEL_ID },
    });
  });
});

describe("useDetection", () => {
  it("throws outside the provider", () => {
    const orphan = () => render(<Probe />);
    expect(orphan).toThrow(/DetectionProvider/);
  });
});
