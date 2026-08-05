import { track } from "@vercel/analytics";
import { act, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useState } from "react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DetectionProvider,
  useDetection,
  WORKER_RECYCLE_AFTER_MS,
} from "@/context/DetectionContext";

import {
  DEVELOPER_OPTIONS_OFF,
  SETTINGS_VERSION,
  SettingsProvider,
  STORAGE_KEY,
  useSettings,
} from "@/context/SettingsContext";
import { DEFAULT_MODEL, STORED_MODELS_KEY } from "@/lib/detectionModels";
import { ZOOM_2X, ZOOM_OFF } from "@/workers/detection/consts";

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
