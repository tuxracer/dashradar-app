import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CameraView } from "@/components/CameraView";
import { isCameraError } from "@/lib/camera";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CameraView", () => {
  it("attaches the stream and reports the video element", async () => {
    const stop = vi.fn();
    const fakeStream = {
      getTracks: () => [{ stop }],
    } as unknown as MediaStream;
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn(() => Promise.resolve(fakeStream)) },
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();

    const onStream = vi.fn();
    const { container, unmount } = render(
      <CameraView onStream={onStream} onError={() => {}} />,
    );
    await waitFor(() => expect(onStream).toHaveBeenCalled());
    const video = container.querySelector("video");
    expect(onStream).toHaveBeenCalledWith(video);
    expect(video?.muted).toBe(true);

    unmount();
    expect(stop).toHaveBeenCalled();
  });

  it("reports updated dimensions when the video element fires resize", async () => {
    const fakeStream = {
      getTracks: () => [{ stop: () => {} }],
    } as unknown as MediaStream;
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn(() => Promise.resolve(fakeStream)) },
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();

    const onStream = vi.fn();
    const onVideoResize = vi.fn();
    const { container } = render(
      <CameraView
        onStream={onStream}
        onError={() => {}}
        onVideoResize={onVideoResize}
      />,
    );
    await waitFor(() => expect(onStream).toHaveBeenCalled());
    const video = container.querySelector("video");
    if (!video) {
      throw new Error("video element not found");
    }

    // jsdom always reports 0x0 for videoWidth/videoHeight; stub them so the
    // resize event carries the post-rotation dimensions a real device would.
    Object.defineProperty(video, "videoWidth", { value: 1080 });
    Object.defineProperty(video, "videoHeight", { value: 1920 });
    video.dispatchEvent(new Event("resize"));

    expect(onVideoResize).toHaveBeenCalledWith(video);
    expect(video.videoWidth).toBe(1080);
    expect(video.videoHeight).toBe(1920);
  });

  it("reports a typed camera error", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(() =>
          Promise.reject(new DOMException("denied", "NotAllowedError")),
        ),
      },
    });
    const onError = vi.fn();
    render(<CameraView onStream={() => {}} onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalled());
    const error: unknown = onError.mock.calls[0][0];
    expect(isCameraError(error) && error.code).toBe("PERMISSION_DENIED");
  });

  it("always keeps the video mounted but visually hidden", async () => {
    const fakeStream = {
      getTracks: () => [{ stop: () => {} }],
    } as unknown as MediaStream;
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn(() => Promise.resolve(fakeStream)) },
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();

    const onStream = vi.fn();
    const { container } = render(
      <CameraView onStream={onStream} onError={() => {}} />,
    );
    await waitFor(() => expect(onStream).toHaveBeenCalled());
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveClass("opacity-0");
  });
});
