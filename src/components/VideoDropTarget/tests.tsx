import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoDropTarget } from "@/components/VideoDropTarget";
import { SettingsProvider, STORAGE_KEY } from "@/context/SettingsContext";
import { VideoSourceProvider } from "@/context/VideoSourceContext";

/** The engine's video detach, which the provider calls on every swap. */
vi.mock("@/context/DetectionContext", () => ({
  useDetection: () => ({ detachVideo: () => {} }),
}));

/**
 * Dispatches a window drop carrying a single video file, as a drag does, and
 * reports whether the default action survived: false means it was cancelled.
 */
const dropClipOnWindow = () => {
  const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
  const event = new Event("drop", { cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
  return window.dispatchEvent(event);
};

const renderTarget = () =>
  render(
    <SettingsProvider>
      <VideoSourceProvider>
        <VideoDropTarget />
      </VideoSourceProvider>
    </SettingsProvider>,
  );

/** Renders with Developer options already on, which is what a drop needs. */
const renderTargetWithDeveloperOptions = () => {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ developerOptions: true }),
  );
  return renderTarget();
};

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:mock/clip");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("VideoDropTarget", () => {
  it("takes a clip dropped anywhere on the window", () => {
    renderTargetWithDeveloperOptions();
    dropClipOnWindow();
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("stops listening to the window once unmounted", () => {
    renderTargetWithDeveloperOptions().unmount();
    dropClipOnWindow();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("ignores a dropped clip while developer options are off", () => {
    renderTarget();
    dropClipOnWindow();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  // Refusing the drag instead would hand the drop to the browser, which
  // navigates away from the file and ends the session.
  it("still cancels the drop while developer options are off", () => {
    renderTarget();
    expect(dropClipOnWindow()).toBe(false);
  });
});
