import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { STORAGE_KEY } from "@/context/SettingsContext";
import { STORED_MODELS_KEY } from "@/lib/detectionModels";

afterEach(() => {
  workerOnMessage = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

beforeEach(() => {
  // jsdom has no media playback at all; without this the camera feed logs to
  // the console on its first play() attempt.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
});

/**
 * The message handler DetectionContext installs on its worker, captured by
 * FakeWorker's setter so a test can deliver worker responses by hand.
 */
let workerOnMessage: ((event: { data: unknown }) => void) | null = null;

/** Worker stub: the real detection worker cannot run under jsdom. */
class FakeWorker {
  onerror = null;
  set onmessage(handler: ((event: { data: unknown }) => void) | null) {
    workerOnMessage = handler;
  }
  get onmessage() {
    return workerOnMessage;
  }
  postMessage() {}
  terminate() {}
}

/**
 * Drives the worker to ready. This is the edge that starts a dropped clip
 * playing, and it is also the precondition for the camera existing at all: the
 * app holds getUserMedia back until the model is loaded and warmed, so no
 * camera-view element is in the tree before this resolves.
 */
const reachModelReady = async () => {
  await waitFor(() => expect(workerOnMessage).not.toBeNull());
  await act(async () => {
    workerOnMessage?.({ data: { type: "ready" } });
  });
};

/** getUserMedia stand-in resolving to a stream whose tracks can be stopped. */
const grantedCamera = () =>
  Promise.resolve({
    getTracks: () => [{ stop: () => {} }],
  } as unknown as MediaStream);

/**
 * Stubs the two globals the app reaches for on startup. Omitting the camera
 * leaves `navigator` bare, which is how a browser with no camera API at all
 * presents itself.
 */
const stubBrowser = (getUserMedia?: () => Promise<MediaStream>) => {
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal(
    "navigator",
    getUserMedia ? { mediaDevices: { getUserMedia } } : {},
  );
};

/** Walks the first-open intro and the in-app permission ask. */
const acceptFirstRunScreens = () => {
  fireEvent.click(screen.getByRole("button", { name: "START" }));
  fireEvent.click(screen.getByRole("button", { name: "ALLOW CAMERA" }));
};

describe("App", () => {
  it("walks first open through intro, permission ask, then the camera error screen when the camera is unavailable", async () => {
    stubBrowser();
    render(<App />);
    acceptFirstRunScreens();
    await reachModelReady();
    await waitFor(() =>
      expect(
        screen.getByText(/browser can't access the camera/i),
      ).toBeInTheDocument(),
    );
  });

  it("leaves the camera alone until the model is ready", async () => {
    const getUserMedia = vi.fn(grantedCamera);
    stubBrowser(getUserMedia);
    render(<App />);
    acceptFirstRunScreens();
    await waitFor(() => expect(workerOnMessage).not.toBeNull());
    // Session creation and the worker's warm-up run are the heaviest moment
    // the GPU process sees; a live camera stream must not be holding buffers
    // through it. Asking early is what put both peaks on the same instant.
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.queryByTestId("camera-view")).not.toBeInTheDocument();
    await reachModelReady();
    await screen.findByTestId("camera-view");
    expect(getUserMedia).toHaveBeenCalled();
  });

  it("holds the camera back while a launch update is installing", async () => {
    const getUserMedia = vi.fn(grantedCamera);
    // A page controlled by a previous build, with an update mid-install. On
    // iOS the camera permission prompt repeats every launch, so asking before
    // the update's reload would make the driver answer it twice.
    const listeners = new Set<() => void>();
    const installing = {
      state: "installing",
      addEventListener: (_type: string, listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        listeners.delete(listener);
      },
    };
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia },
      serviceWorker: {
        controller: {},
        getRegistration: () =>
          Promise.resolve({
            installing,
            waiting: null,
            update: () => Promise.resolve(),
          }),
      },
    });
    render(<App />);
    acceptFirstRunScreens();
    await reachModelReady();
    expect(screen.queryByTestId("camera-view")).not.toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();
    // The install dying means the update's reload is never coming, which is
    // one of the gate's release edges; the camera then proceeds as normal.
    await act(async () => {
      installing.state = "redundant";
      for (const listener of [...listeners]) {
        listener();
      }
    });
    await screen.findByTestId("camera-view");
    expect(getUserMedia).toHaveBeenCalled();
  });

  it("still shows the intro to a device that cannot run inference", async () => {
    stubBrowser(grantedCamera);
    render(<App />);
    await waitFor(() => expect(workerOnMessage).not.toBeNull());
    await act(async () => {
      workerOnMessage?.({
        data: { type: "worker-error", code: "WEBGPU_UNSUPPORTED" },
      });
    });
    expect(screen.getByRole("button", { name: "START" })).toBeInTheDocument();
  });

  it("turns an unsupported device away after the intro, without asking for the camera", async () => {
    const getUserMedia = vi.fn(grantedCamera);
    stubBrowser(getUserMedia);
    render(<App />);
    await waitFor(() => expect(workerOnMessage).not.toBeNull());
    await act(async () => {
      workerOnMessage?.({
        data: { type: "worker-error", code: "WEBGPU_UNSUPPORTED" },
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "START" }));
    expect(
      screen.getByRole("heading", { name: /open it on another phone/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "ALLOW CAMERA" }),
    ).not.toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("offers no retry on the unsupported screen, which a reload cannot clear", async () => {
    stubBrowser(grantedCamera);
    render(<App />);
    await waitFor(() => expect(workerOnMessage).not.toBeNull());
    await act(async () => {
      workerOnMessage?.({
        data: { type: "worker-error", code: "WEBGPU_UNSUPPORTED" },
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "START" }));
    expect(
      screen.queryByRole("button", { name: "TRY AGAIN" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("dashradar.app")).toBeInTheDocument();
  });

  it("shows the camera access denied screen when the permission ask is declined", () => {
    stubBrowser();
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "START" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(
      screen.getByRole("heading", { name: /camera access needed/i }),
    ).toBeInTheDocument();
  });

  it("skips the permission ask once it has been accepted before", () => {
    stubBrowser();
    window.localStorage.setItem("cameraPromptAccepted", "true");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "START" }));
    expect(
      screen.queryByRole("button", { name: "ALLOW CAMERA" }),
    ).not.toBeInTheDocument();
  });

  it("swaps the meter for the detection view when the setting is on", async () => {
    // Seeded rather than tapped through the panel: the row's own wiring is
    // covered in the settings tests, and what matters here is the swap.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true, detectionView: true }),
    );
    stubBrowser(grantedCamera);
    render(<App />);
    acceptFirstRunScreens();
    await reachModelReady();
    await screen.findByTestId("detection-view");
    // The meter, and with it the beeper and the contact card, is gone.
    expect(screen.queryByTestId("signal-status")).toBeNull();
  });

  it("keeps the meter and hides the feed with the setting off", async () => {
    stubBrowser(grantedCamera);
    render(<App />);
    acceptFirstRunScreens();
    await reachModelReady();
    await screen.findByTestId("signal-status");
    expect(screen.queryByTestId("detection-view")).toBeNull();
    // The feed is never shown outside the developer option.
    expect(screen.getByTestId("camera-view").className).toContain("opacity-0");
  });

  it("offers no revert action for a model load failure while the default model is active", async () => {
    stubBrowser(grantedCamera);
    render(<App />);
    acceptFirstRunScreens();
    await waitFor(() => expect(workerOnMessage).not.toBeNull());
    await act(async () => {
      workerOnMessage?.({
        data: { type: "worker-error", code: "MODEL_LOAD_FAILED" },
      });
    });
    await screen.findByTestId("error-message");
    expect(
      screen.queryByRole("button", { name: "USE DEFAULT MODEL" }),
    ).not.toBeInTheDocument();
  });

  it("offers a revert action for a model load failure while a non-default model is pinned", async () => {
    // The session pins activeModel at mount from modelIds, which only reads a
    // stored selection with developer options on; the stored entry itself has
    // to be a real registered model, or resolveModels would fall back to the
    // default and the revert action would never appear.
    const storedModel = {
      id: "https://huggingface.co/someone/some-repo/resolve/abc123/model.onnx",
      owner: "someone",
      slug: "some-repo",
      revision: "abc123",
      file: "model.onnx",
    };
    window.localStorage.setItem(
      STORED_MODELS_KEY,
      JSON.stringify([storedModel]),
    );
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        developerOptions: true,
        modelIds: [storedModel.id],
      }),
    );
    stubBrowser(grantedCamera);
    render(<App />);
    acceptFirstRunScreens();
    await waitFor(() => expect(workerOnMessage).not.toBeNull());
    await act(async () => {
      workerOnMessage?.({
        data: { type: "worker-error", code: "MODEL_LOAD_FAILED" },
      });
    });
    expect(
      await screen.findByRole("button", { name: "USE DEFAULT MODEL" }),
    ).toBeInTheDocument();
  });

  // Guard tests for the scene-mode branch: jsdom has no WebGL, so entering
  // scene mode here always exercises the render-failure fallback, which is
  // exactly the never-a-dead-main-view guarantee the branch must keep.
  it("degrades scene mode back to the radar view where WebGL is unavailable", async () => {
    stubBrowser(grantedCamera);
    render(<App />);
    acceptFirstRunScreens();
    await reachModelReady();
    fireEvent.click(
      screen.getByRole("button", { name: "Switch to scene view" }),
    );
    // The scene's WebGL probe fails, the view reports render failure, and the
    // app both re-renders the radar screen and reverts the persisted setting
    // so the toggle never claims a view the screen is not in.
    await waitFor(() =>
      expect(screen.getByTestId("signal-status")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("scene-view")).not.toBeInTheDocument();
    await waitFor(() => {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored ?? "{}").viewMode).toBe("radar");
    });
  });

  it("lands on the radar view when a persisted scene mode meets no WebGL", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ viewMode: "scene" }),
    );
    stubBrowser(grantedCamera);
    render(<App />);
    acceptFirstRunScreens();
    await reachModelReady();
    await waitFor(() =>
      expect(screen.getByTestId("signal-status")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("scene-view")).not.toBeInTheDocument();
  });

  it("hides the view toggle while the detection view developer option is on", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true, detectionView: true }),
    );
    stubBrowser(grantedCamera);
    render(<App />);
    acceptFirstRunScreens();
    await reachModelReady();
    expect(
      screen.queryByRole("button", { name: /Switch to/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open settings" })).toBeVisible();
  });
});
