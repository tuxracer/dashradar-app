import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CameraPreview } from "@/components/CameraPreview";

afterEach(() => {
  vi.restoreAllMocks();
});

const createSource = (stream: MediaStream | null): HTMLVideoElement => {
  const source = document.createElement("video");
  source.srcObject = stream;
  return source;
};

describe("CameraPreview", () => {
  it("plays the source's stream in its own muted video", () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue();
    const stream = { id: "fake-stream" } as unknown as MediaStream;
    const { container } = render(
      <CameraPreview source={createSource(stream)} />,
    );
    const video = container.querySelector("video");
    expect(video?.srcObject).toBe(stream);
    expect(video?.muted).toBe(true);
    expect(play).toHaveBeenCalled();
  });

  it("detaches the stream on unmount", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const stream = { id: "fake-stream" } as unknown as MediaStream;
    const { container, unmount } = render(
      <CameraPreview source={createSource(stream)} />,
    );
    const video = container.querySelector("video");
    unmount();
    expect(video?.srcObject).toBeNull();
  });

  it("stays idle when the source has no stream yet", () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue();
    const { container } = render(<CameraPreview source={createSource(null)} />);
    // jsdom reports a never-assigned srcObject as undefined rather than the
    // spec's null; either way no stream was attached.
    expect(container.querySelector("video")?.srcObject).toBeFalsy();
    expect(play).not.toHaveBeenCalled();
  });
});
