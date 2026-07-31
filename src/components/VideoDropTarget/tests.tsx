import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VideoDropTarget } from "@/components/VideoDropTarget";
import { DevVideoProvider } from "@/context/DevVideoContext";
import { SettingsProvider } from "@/context/SettingsContext";

/** Stands in for DetectionContext's feed swap, which needs no worker here. */
const swapVideoSource = vi.fn();

vi.mock("@/context/DetectionContext", () => ({
  useDetection: () => ({ swapVideoSource }),
}));

/** Dispatches a window drop carrying a single video file. */
const dropClip = () => {
  const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
  const event = new Event("drop", { cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
  window.dispatchEvent(event);
  return file;
};

/** Mounts the drop target under the providers it consumes. */
const renderTarget = () =>
  render(
    <SettingsProvider>
      <DevVideoProvider>
        <VideoDropTarget />
      </DevVideoProvider>
    </SettingsProvider>,
  );

beforeEach(() => {
  swapVideoSource.mockClear();
});

describe("VideoDropTarget", () => {
  it("swaps the feed to a dropped video file", () => {
    renderTarget();
    const file = dropClip();
    expect(swapVideoSource).toHaveBeenCalledWith(file);
  });

  it("ignores drops once unmounted", () => {
    const { unmount } = renderTarget();
    unmount();
    dropClip();
    expect(swapVideoSource).not.toHaveBeenCalled();
  });
});
