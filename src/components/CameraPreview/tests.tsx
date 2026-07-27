import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CameraPreview } from "@/components/CameraPreview";
import { ZOOM_2X, ZOOM_OFF } from "@/workers/detection/consts";

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
      <CameraPreview source={createSource(stream)} zoom={ZOOM_OFF} />,
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
      <CameraPreview source={createSource(stream)} zoom={ZOOM_OFF} />,
    );
    const video = container.querySelector("video");
    unmount();
    expect(video?.srcObject).toBeNull();
  });

  it("stays idle when the source has no stream yet", () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue();
    const { container } = render(
      <CameraPreview source={createSource(null)} zoom={ZOOM_OFF} />,
    );
    // jsdom reports a never-assigned srcObject as undefined rather than the
    // spec's null; either way no stream was attached.
    expect(container.querySelector("video")?.srcObject).toBeFalsy();
    expect(play).not.toHaveBeenCalled();
  });

  // The preview must show the model's capture region, not the whole feed: the
  // square container's cover-fit video is the centered square crop, and the
  // scale narrows it to the centered 1/zoom region a digital zoom samples.
  it("cover-crops the feed to the centered square at 1x", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const stream = { id: "fake-stream" } as unknown as MediaStream;
    const { container, getByTestId } = render(
      <CameraPreview source={createSource(stream)} zoom={ZOOM_OFF} />,
    );
    expect(getByTestId("camera-preview")).toHaveClass("aspect-square");
    const video = container.querySelector("video");
    expect(video).toHaveClass("object-cover");
    expect(video).toHaveStyle({ transform: `scale(${ZOOM_OFF})` });
  });

  it("narrows to the centered half-side region at 2x", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const stream = { id: "fake-stream" } as unknown as MediaStream;
    const { container } = render(
      <CameraPreview source={createSource(stream)} zoom={ZOOM_2X} />,
    );
    expect(container.querySelector("video")).toHaveStyle({
      transform: `scale(${ZOOM_2X})`,
    });
  });
});
