import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CameraView } from "@/components/CameraView";
import { isCameraError } from "@/lib/camera";
import type { CameraFeedEvent } from "@/lib/camera";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CameraView", () => {
  it("reports active with the video element once the stream attaches", async () => {
    const stop = vi.fn();
    const fakeStream = {
      getTracks: () => [{ stop }],
    } as unknown as MediaStream;
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn(() => Promise.resolve(fakeStream)) },
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();

    const onEvent = vi.fn();
    const { container, unmount } = render(
      <CameraView onEvent={onEvent} onError={() => {}} />,
    );
    await waitFor(() => expect(onEvent).toHaveBeenCalled());
    const video = container.querySelector("video");
    expect(onEvent).toHaveBeenCalledWith({ type: "active", video });
    expect(video?.muted).toBe(true);

    unmount();
    expect(stop).toHaveBeenCalled();
  });

  it("reports a resize event when the video element fires resize", async () => {
    const fakeStream = {
      getTracks: () => [{ stop: () => {} }],
    } as unknown as MediaStream;
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn(() => Promise.resolve(fakeStream)) },
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();

    const events: CameraFeedEvent[] = [];
    const { container } = render(
      <CameraView
        onEvent={(event) => {
          events.push(event);
        }}
        onError={() => {}}
      />,
    );
    await waitFor(() => expect(events).toHaveLength(1));
    const video = container.querySelector("video");
    if (!video) {
      throw new Error("video element not found");
    }

    // jsdom always reports 0x0 for videoWidth/videoHeight; stub them so the
    // resize event carries the post-rotation dimensions a real device would.
    Object.defineProperty(video, "videoWidth", { value: 1080 });
    Object.defineProperty(video, "videoHeight", { value: 1920 });
    video.dispatchEvent(new Event("resize"));

    expect(events[1]).toEqual({ type: "resize", video });
    expect(video.videoWidth).toBe(1080);
  });

  // A feed swap unmounts this component while play() is still pending. If the
  // late resolution still reported the element, the pump would be handed a
  // detached video whose frames never arrive.
  it("reports nothing when it unmounts mid-play", async () => {
    const fakeStream = {
      getTracks: () => [{ stop: () => {} }],
    } as unknown as MediaStream;
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn(() => Promise.resolve(fakeStream)) },
    });
    let finishPlay = () => {};
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finishPlay = resolve;
          }),
      );

    const onEvent = vi.fn();
    const { unmount } = render(
      <CameraView onEvent={onEvent} onError={() => {}} />,
    );
    await waitFor(() => expect(playSpy).toHaveBeenCalled());
    expect(onEvent).not.toHaveBeenCalled();

    unmount();
    await act(async () => {
      finishPlay();
    });
    expect(onEvent).not.toHaveBeenCalled();
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
    render(<CameraView onEvent={() => {}} onError={onError} />);
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

    const onEvent = vi.fn();
    const { container } = render(
      <CameraView onEvent={onEvent} onError={() => {}} />,
    );
    await waitFor(() => expect(onEvent).toHaveBeenCalled());
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveClass("opacity-0");
  });
});
