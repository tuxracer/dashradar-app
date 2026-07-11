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
});
