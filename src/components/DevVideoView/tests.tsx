import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DevVideoView } from "@/components/DevVideoView";
import { isCameraError } from "@/lib/camera";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DevVideoView", () => {
  it("plays the file and reports the video element", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const onStream = vi.fn();
    const { container } = render(
      <DevVideoView
        src="/__dev-video"
        onStream={onStream}
        onError={() => {}}
      />,
    );
    await waitFor(() => expect(onStream).toHaveBeenCalled());
    const video = container.querySelector("video");
    expect(onStream).toHaveBeenCalledWith(video);
    expect(video?.getAttribute("src")).toBe("/__dev-video");
    expect(video?.muted).toBe(true);
    expect(video?.loop).toBe(true);
    expect(video?.controls).toBe(true);
  });

  it("stays visible with player controls, unlike the hidden camera feed", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const { container } = render(
      <DevVideoView
        src="/__dev-video"
        onStream={() => {}}
        onError={() => {}}
      />,
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).not.toHaveClass("opacity-0");
  });

  it("maps a playback failure to a typed camera error", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(
      new Error("no supported source"),
    );
    const onError = vi.fn();
    render(
      <DevVideoView src="/__dev-video" onStream={() => {}} onError={onError} />,
    );
    await waitFor(() => expect(onError).toHaveBeenCalled());
    const error: unknown = onError.mock.calls[0][0];
    expect(isCameraError(error) && error.code).toBe("NO_CAMERA");
  });

  it("reports updated dimensions when the video fires resize", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const onStream = vi.fn();
    const onVideoResize = vi.fn();
    const { container } = render(
      <DevVideoView
        src="/__dev-video"
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
    // jsdom always reports 0x0; stub the intrinsic size a real file would have.
    Object.defineProperty(video, "videoWidth", { value: 1920 });
    Object.defineProperty(video, "videoHeight", { value: 1080 });
    video.dispatchEvent(new Event("resize"));
    expect(onVideoResize).toHaveBeenCalledWith(video);
  });
});
