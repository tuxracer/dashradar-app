import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useVideoSource,
  VideoSourceProvider,
} from "@/context/VideoSourceContext";

/** The engine's video detach, which every swap has to go through. */
const detachVideo = vi.fn();
vi.mock("@/context/DetectionContext", () => ({
  useDetection: () => ({ detachVideo }),
}));

/** Factory function for a test video file. */
const clip = (name: string) => new File(["x"], name, { type: "video/mp4" });

const renderVideoSource = () =>
  renderHook(() => useVideoSource(), { wrapper: VideoSourceProvider });

beforeEach(() => {
  detachVideo.mockClear();
  let minted = 0;
  URL.createObjectURL = vi.fn(() => `blob:mock/clip-${++minted}`);
  URL.revokeObjectURL = vi.fn();
});

describe("VideoSourceProvider", () => {
  it("starts every session on the camera", () => {
    const { result } = renderVideoSource();
    expect(result.current.source).toBeNull();
  });

  it("publishes a chosen file as an object URL the player can play", () => {
    const { result } = renderVideoSource();
    act(() => result.current.setVideoFile(clip("drive.mp4")));
    expect(result.current.source).toEqual({
      url: "blob:mock/clip-1",
      name: "drive.mp4",
    });
  });

  it("detaches the engine's video before the feed changes under it", () => {
    const { result } = renderVideoSource();
    act(() => result.current.setVideoFile(clip("drive.mp4")));
    expect(detachVideo).toHaveBeenCalledTimes(1);
    act(() => result.current.clearVideoFile());
    expect(detachVideo).toHaveBeenCalledTimes(2);
  });

  it("releases a clip that has been replaced", () => {
    const { result } = renderVideoSource();
    act(() => result.current.setVideoFile(clip("first.mp4")));
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    act(() => result.current.setVideoFile(clip("second.mp4")));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock/clip-1");
  });

  it("releases the clip when the feed goes back to the camera", () => {
    const { result } = renderVideoSource();
    act(() => result.current.setVideoFile(clip("drive.mp4")));
    act(() => result.current.clearVideoFile());
    expect(result.current.source).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock/clip-1");
  });

  // Consumers key feed-scoped state on this id. Both camera sessions have a
  // null source, so identity alone cannot tell them apart, and a consumer that
  // could not would carry a dead camera's failure into the fresh one.
  it("gives the camera session after a clip an id of its own", () => {
    const { result } = renderVideoSource();
    const before = result.current.feedId;
    act(() => result.current.setVideoFile(clip("drive.mp4")));
    act(() => result.current.clearVideoFile());
    expect(result.current.source).toBeNull();
    expect(result.current.feedId).not.toBe(before);
  });
});
