import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "@/App";

/**
 * Mutable stand-in for the compile-time DEV_VIDEO_URL define, so individual
 * tests can flip the app between camera mode (null) and dev video mode.
 */
const devVideo = vi.hoisted(() => ({ url: null as string | null }));

vi.mock("@/lib/devVideo", () => ({
  get DEV_VIDEO_URL() {
    return devVideo.url;
  },
}));

afterEach(() => {
  devVideo.url = null;
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

/** Worker stub: the real detection worker cannot run under jsdom. */
class FakeWorker {
  onmessage = null;
  onerror = null;
  postMessage() {}
  terminate() {}
}

describe("App", () => {
  it("shows the intro on first open, then the camera error screen when the camera is unavailable", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", {});
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "START" }));
    await waitFor(() =>
      expect(
        screen.getByText(/browser can't access the camera/i),
      ).toBeInTheDocument(),
    );
  });

  it("skips the intro and never requests the camera in dev video mode", () => {
    devVideo.url = "/__dev-video";
    vi.stubGlobal("Worker", FakeWorker);
    const getUserMedia = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    const { container } = render(<App />);
    expect(
      screen.queryByRole("button", { name: "START" }),
    ).not.toBeInTheDocument();
    expect(container.querySelector("video")?.getAttribute("src")).toBe(
      "/__dev-video",
    );
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
