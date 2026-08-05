import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VideoDropTarget } from "@/components/VideoDropTarget";
import { VideoSourceProvider } from "@/context/VideoSourceContext";

/** The engine's video detach, which the provider calls on every swap. */
vi.mock("@/context/DetectionContext", () => ({
  useDetection: () => ({ detachVideo: () => {} }),
}));

/** Dispatches a window drop carrying a single video file, as a drag does. */
const dropClipOnWindow = () => {
  const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
  const event = new Event("drop", { cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
  window.dispatchEvent(event);
};

const renderTarget = () =>
  render(
    <VideoSourceProvider>
      <VideoDropTarget />
    </VideoSourceProvider>,
  );

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:mock/clip");
  URL.revokeObjectURL = vi.fn();
});

describe("VideoDropTarget", () => {
  it("takes a clip dropped anywhere on the window", () => {
    renderTarget();
    dropClipOnWindow();
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("stops listening to the window once unmounted", () => {
    renderTarget().unmount();
    dropClipOnWindow();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
