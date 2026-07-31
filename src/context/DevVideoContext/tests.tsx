import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DevVideoProvider,
  useDevVideo,
  type DevVideoContextValue,
} from "@/context/DevVideoContext";

let latest: DevVideoContextValue;

/** Publishes the context value to the test and renders it for assertions. */
const Probe = () => {
  // eslint-disable-next-line react-hooks/globals
  latest = useDevVideo();
  return (
    <span data-testid="state">
      {latest.source ? latest.source.name : "camera"}:
      {latest.source ? latest.source.url : "none"}
    </span>
  );
};

/** Renders the probe inside a real provider. */
const renderProvider = () =>
  render(
    <DevVideoProvider>
      <Probe />
    </DevVideoProvider>,
  );

/** The probe's rendered "name:url" summary of the current source. */
const state = () => screen.getByTestId("state").textContent;

/** A dummy video File the provider will mint an object URL for. */
const clip = (name = "clip.mp4") =>
  new File(["x"], name, { type: "video/mp4" });

beforeEach(() => {
  let created = 0;
  // jsdom implements neither, and the provider's whole job is their lifecycle.
  URL.createObjectURL = vi.fn(() => `blob:mock/${(created += 1)}`);
  URL.revokeObjectURL = vi.fn();
});

describe("DevVideoProvider", () => {
  it("starts every session on the camera", () => {
    renderProvider();
    expect(state()).toBe("camera:none");
  });

  it("makes a chosen file the source", () => {
    renderProvider();
    act(() => latest.setVideoFile(clip()));
    expect(state()).toBe("clip.mp4:blob:mock/1");
  });

  it("revokes only the replaced clip when a second file arrives", () => {
    renderProvider();
    act(() => latest.setVideoFile(clip("first.mp4")));
    act(() => latest.setVideoFile(clip("second.mp4")));
    expect(state()).toBe("second.mp4:blob:mock/2");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock/1");
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:mock/2");
  });

  it("does not revoke the clip while it is still the source", () => {
    renderProvider();
    act(() => latest.setVideoFile(clip()));
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("returns to the camera and revokes on clear", () => {
    renderProvider();
    act(() => latest.setVideoFile(clip()));
    act(() => latest.clearVideoFile());
    expect(state()).toBe("camera:none");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock/1");
  });

  it("reports the camera outside a provider so consumers still work", () => {
    render(<Probe />);
    expect(state()).toBe("camera:none");
  });
});
