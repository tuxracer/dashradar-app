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

/** Worker stub: the real detection worker cannot run under jsdom. */
class FakeWorker {
  onmessage = null;
  onerror = null;
  postMessage() {}
  terminate() {}
}

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
    await waitFor(() =>
      expect(
        screen.getByText(/browser can't access the camera/i),
      ).toBeInTheDocument(),
    );
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
    window.localStorage.setItem("dashradar:cameraPromptAccepted", "true");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "START" }));
    expect(
      screen.queryByRole("button", { name: "ALLOW CAMERA" }),
    ).not.toBeInTheDocument();
  });

  it("plays a dropped clip instead of the camera", async () => {
    stubBrowser(grantedCamera);
    render(<App />);
    acceptFirstRunScreens();
    await screen.findByTestId("camera-view");
    act(() => dropClipOnWindow());
    expect(await screen.findByTestId("dev-video-view")).toBeInTheDocument();
    expect(screen.queryByTestId("camera-view")).not.toBeInTheDocument();
  });

  it("returns to the camera when the clip is cleared", async () => {
    stubBrowser(grantedCamera);
    render(<App />);
    acceptFirstRunScreens();
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
    await screen.findByRole("heading", { name: /camera access needed/i });
    act(() => dropClipOnWindow());
    await screen.findByTestId("dev-video-view");
    act(() => detection.swapVideoSource(null));
    expect(await screen.findByTestId("camera-view")).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });
});
