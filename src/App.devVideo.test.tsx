import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";

// DEV_VIDEO_URL reaches the app through ENV_VIDEO_SOURCE, a module-level const
// evaluated when the module graph is first imported. A test body runs long
// after that, so the DASHRADAR_VIDEO startup feed can only be staged from a
// file whose whole run is in dev video mode; the camera cases live in
// App.test.tsx, which gets the real (null) define.
vi.mock("@/lib/devVideo", () => ({ DEV_VIDEO_URL: "/__dev-video" }));

/** Worker stub: the real detection worker cannot run under jsdom. */
class FakeWorker {
  onmessage = null;
  onerror = null;
  postMessage() {}
  terminate() {}
}

beforeEach(() => {
  // jsdom has no media playback, and the clip's player would log on first use.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("App in dev video mode", () => {
  it("skips the intro and never requests the camera", () => {
    vi.stubGlobal("Worker", FakeWorker);
    const getUserMedia = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    render(<App />);
    expect(
      screen.queryByRole("button", { name: "START" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("dev-video-view").getAttribute("src")).toBe(
      "/__dev-video",
    );
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
