import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import type { DetectionContextValue } from "@/context/DetectionContext";

/**
 * The live DetectionContext value, published by the passthrough hook below so
 * a test can drive a feed swap the way the settings panel will. The provider
 * itself stays real: only the hook is wrapped.
 */
let detection: DetectionContextValue;

vi.mock("@/context/DetectionContext", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/context/DetectionContext")>();
  return {
    ...actual,
    useDetection: () => {
      detection = actual.useDetection();
      return detection;
    },
  };
});

afterEach(() => {
  workerOnMessage = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

beforeEach(() => {
  // jsdom implements neither, and a dropped clip is played from an object URL.
  URL.createObjectURL = vi.fn(() => "blob:mock/clip");
  URL.revokeObjectURL = vi.fn();
  // jsdom has no media playback at all; without this both feeds log to the
  // console on their first play() attempt.
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

/** getUserMedia stand-in rejecting the way a denied browser prompt does. */
const deniedCamera = () =>
  Promise.reject(new DOMException("denied", "NotAllowedError"));

/** getUserMedia stand-in that denies the first ask and grants every later one. */
const deniedThenGrantedCamera = () => {
  let asked = false;
  return vi.fn(() => {
    if (asked) {
      return grantedCamera();
    }
    asked = true;
    return deniedCamera();
  });
};

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

/** Dispatches a window drop carrying a single video file, as a drag does. */
const dropClipOnWindow = () => {
  const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
  const event = new Event("drop", { cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
  window.dispatchEvent(event);
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

  it("autoplays a dropped clip once the model is ready", async () => {
    stubBrowser(grantedCamera);
    render(<App />);
    acceptFirstRunScreens();
    // Dropped while the model is still loading, so the ready edge below is
    // what starts it playing. The camera does not exist yet at this point.
    act(() => dropClipOnWindow());
    const player = await screen.findByTestId("dev-video-view");
    await reachModelReady();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(player).not.toHaveClass("invisible");
  });

  it("autoplays a clip dropped into an already scanning session", async () => {
    stubBrowser(grantedCamera);
    render(<App />);
    acceptFirstRunScreens();
    await reachModelReady();
    await screen.findByTestId("camera-view");
    vi.mocked(HTMLMediaElement.prototype.play).mockClear();
    act(() => dropClipOnWindow());
    const player = await screen.findByTestId("dev-video-view");
    await waitFor(() =>
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalled(),
    );
    expect(player).not.toHaveClass("invisible");
  });

  it("plays a dropped clip instead of the camera", async () => {
    stubBrowser(grantedCamera);
    render(<App />);
    acceptFirstRunScreens();
    await reachModelReady();
    await screen.findByTestId("camera-view");
    act(() => dropClipOnWindow());
    expect(await screen.findByTestId("dev-video-view")).toBeInTheDocument();
    expect(screen.queryByTestId("camera-view")).not.toBeInTheDocument();
  });

  it("returns to the camera when the clip is cleared", async () => {
    stubBrowser(grantedCamera);
    render(<App />);
    acceptFirstRunScreens();
    await reachModelReady();
    act(() => dropClipOnWindow());
    await screen.findByTestId("dev-video-view");
    act(() => detection.swapVideoSource(null));
    expect(await screen.findByTestId("camera-view")).toBeInTheDocument();
    expect(screen.queryByTestId("dev-video-view")).not.toBeInTheDocument();
  });

  it("skips the camera error screen while a clip is playing", async () => {
    stubBrowser(deniedCamera);
    render(<App />);
    acceptFirstRunScreens();
    await reachModelReady();
    await screen.findByRole("heading", { name: /camera access needed/i });
    act(() => dropClipOnWindow());
    expect(await screen.findByTestId("dev-video-view")).toBeInTheDocument();
  });

  // A video/* file the browser cannot decode (ProRes .mov, H.265 .mp4, .mkv)
  // passes the drop filter, and the pump then waits forever on a frame
  // callback that never fires, with the stall watchdog off for a file feed.
  it("returns to the camera when the dropped clip cannot be decoded", async () => {
    stubBrowser(grantedCamera);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<App />);
    acceptFirstRunScreens();
    await reachModelReady();
    act(() => dropClipOnWindow());
    const player = await screen.findByTestId("dev-video-view");

    act(() => {
      fireEvent.error(player);
    });

    expect(await screen.findByTestId("camera-view")).toBeInTheDocument();
    expect(screen.queryByTestId("dev-video-view")).not.toBeInTheDocument();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("asks the camera again after a clip stood in for a failed one", async () => {
    const getUserMedia = deniedThenGrantedCamera();
    stubBrowser(getUserMedia);
    render(<App />);
    acceptFirstRunScreens();
    await reachModelReady();
    await screen.findByRole("heading", { name: /camera access needed/i });
    act(() => dropClipOnWindow());
    await screen.findByTestId("dev-video-view");
    act(() => detection.swapVideoSource(null));
    expect(await screen.findByTestId("camera-view")).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });
});
