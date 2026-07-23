import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DevVideoView } from "@/components/DevVideoView";
import { isCameraError } from "@/lib/camera";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DevVideoView", () => {
  it("reports the video element immediately without starting playback", () => {
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue();
    const onStream = vi.fn();
    const { container } = render(
      <DevVideoView
        src="/__dev-video"
        scanning={false}
        onStream={onStream}
        onError={() => {}}
      />,
    );
    const video = container.querySelector("video");
    expect(onStream).toHaveBeenCalledWith(video);
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("starts playback once on the first scanning transition", async () => {
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue();
    const onStream = vi.fn();
    const { rerender } = render(
      <DevVideoView
        src="/__dev-video"
        scanning={false}
        onStream={onStream}
        onError={() => {}}
      />,
    );
    expect(onStream).toHaveBeenCalled();
    expect(playSpy).not.toHaveBeenCalled();

    rerender(
      <DevVideoView
        src="/__dev-video"
        scanning={true}
        onStream={onStream}
        onError={() => {}}
      />,
    );
    await waitFor(() => expect(playSpy).toHaveBeenCalledTimes(1));

    // Later transitions, including going back to scanning, must not replay.
    rerender(
      <DevVideoView
        src="/__dev-video"
        scanning={false}
        onStream={onStream}
        onError={() => {}}
      />,
    );
    rerender(
      <DevVideoView
        src="/__dev-video"
        scanning={true}
        onStream={onStream}
        onError={() => {}}
      />,
    );
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it("maps a playback failure to a typed camera error", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(
      new Error("no supported source"),
    );
    const onError = vi.fn();
    const { rerender } = render(
      <DevVideoView
        src="/__dev-video"
        scanning={false}
        onStream={() => {}}
        onError={onError}
      />,
    );
    expect(onError).not.toHaveBeenCalled();

    rerender(
      <DevVideoView
        src="/__dev-video"
        scanning={true}
        onStream={() => {}}
        onError={onError}
      />,
    );
    await waitFor(() => expect(onError).toHaveBeenCalled());
    const error: unknown = onError.mock.calls[0][0];
    expect(isCameraError(error) && error.code).toBe("NO_CAMERA");
  });

  it("stays visible with player controls, unlike the hidden camera feed", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const { container } = render(
      <DevVideoView
        src="/__dev-video"
        scanning={false}
        onStream={() => {}}
        onError={() => {}}
      />,
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).not.toHaveClass("opacity-0");
    expect(video?.getAttribute("src")).toBe("/__dev-video");
    expect(video?.muted).toBe(true);
    expect(video?.loop).toBe(true);
    expect(video?.controls).toBe(true);
    expect(video?.hasAttribute("autoplay")).toBe(false);
  });

  it("reports updated dimensions when the video fires resize", () => {
    const onStream = vi.fn();
    const onVideoResize = vi.fn();
    const { container } = render(
      <DevVideoView
        src="/__dev-video"
        scanning={false}
        onStream={onStream}
        onError={() => {}}
        onVideoResize={onVideoResize}
      />,
    );
    expect(onStream).toHaveBeenCalled();
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
