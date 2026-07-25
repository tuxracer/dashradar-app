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
  it("walks first open through intro, permission ask, then the camera error screen when the camera is unavailable", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", {});
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "START" }));
    fireEvent.click(screen.getByRole("button", { name: "ALLOW CAMERA" }));
    await waitFor(() =>
      expect(
        screen.getByText(/browser can't access the camera/i),
      ).toBeInTheDocument(),
    );
  });

  it("shows the camera access denied screen when the permission ask is declined", () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", {});
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "START" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(
      screen.getByRole("heading", { name: /camera access needed/i }),
    ).toBeInTheDocument();
  });

  it("skips the permission ask once it has been accepted before", () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", {});
    window.localStorage.setItem("dashradar:cameraPromptAccepted", "true");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "START" }));
    expect(
      screen.queryByRole("button", { name: "ALLOW CAMERA" }),
    ).not.toBeInTheDocument();
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
