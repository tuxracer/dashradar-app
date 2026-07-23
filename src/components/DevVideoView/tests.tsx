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

  it("hides the player until scanning starts, then shows it with controls", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const { container, rerender } = render(
      <DevVideoView
        src="/__dev-video"
        scanning={false}
        onStream={() => {}}
        onError={() => {}}
      />,
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    // Mounted (the pump needs the element) but not shown during model load.
    expect(video).toHaveClass("invisible");
    expect(video?.getAttribute("src")).toBe("/__dev-video");
    expect(video?.muted).toBe(true);
    expect(video?.loop).toBe(true);
    expect(video?.controls).toBe(true);
    expect(video?.hasAttribute("autoplay")).toBe(false);

    rerender(
      <DevVideoView
        src="/__dev-video"
        scanning={true}
        onStream={() => {}}
        onError={() => {}}
      />,
    );
    await waitFor(() => expect(video).not.toHaveClass("invisible"));
    expect(video).not.toHaveClass("opacity-0");

    // Once shown, the player stays visible through later scanning flips (it
    // belongs to the user then, like the one-shot playback start).
    rerender(
      <DevVideoView
        src="/__dev-video"
        scanning={false}
        onStream={() => {}}
        onError={() => {}}
      />,
    );
    expect(video).not.toHaveClass("invisible");
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
