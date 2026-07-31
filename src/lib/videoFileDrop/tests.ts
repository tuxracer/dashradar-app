import { describe, expect, it, vi } from "vitest";
import {
  attachVideoDropListeners,
  isVideoDropEnabled,
  pickVideoFile,
} from "@/lib/videoFileDrop";

/** jsdom has no DataTransfer constructor, so stand one in with a files array. */
const transferWith = (...files: File[]) =>
  ({ files }) as unknown as DataTransfer;

/** Factory function for a test video file. */
const clip = () => new File(["x"], "clip.mp4", { type: "video/mp4" });

/** Factory function for a test photo file. */
const photo = () => new File(["x"], "photo.png", { type: "image/png" });

/** Dispatches a drop carrying `files` and returns the dispatched event. */
const dispatchDrop = (target: EventTarget, ...files: File[]) => {
  const event = new Event("drop", { cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: transferWith(...files),
  });
  target.dispatchEvent(event);
  return event;
};

describe("pickVideoFile", () => {
  it("returns the first video file in the payload", () => {
    const video = clip();
    expect(pickVideoFile(transferWith(photo(), video))).toBe(video);
  });

  it("returns null when the payload carries no video", () => {
    expect(pickVideoFile(transferWith(photo()))).toBeNull();
  });

  it("returns null when there is no payload at all", () => {
    expect(pickVideoFile(null)).toBeNull();
  });
});

describe("attachVideoDropListeners", () => {
  it("hands a dropped video file to the callback", () => {
    const onFile = vi.fn();
    const target = new EventTarget();
    attachVideoDropListeners(target, onFile);
    const video = clip();
    dispatchDrop(target, video);
    expect(onFile).toHaveBeenCalledWith(video);
  });

  it("ignores a drop that carries no video", () => {
    const onFile = vi.fn();
    const target = new EventTarget();
    attachVideoDropListeners(target, onFile);
    dispatchDrop(target, photo());
    expect(onFile).not.toHaveBeenCalled();
  });

  it("cancels dragover so the browser does not navigate to the file", () => {
    const target = new EventTarget();
    attachVideoDropListeners(target, vi.fn());
    const event = new Event("dragover", { cancelable: true });
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("cancels the drop itself as well", () => {
    const target = new EventTarget();
    attachVideoDropListeners(target, vi.fn());
    expect(dispatchDrop(target, clip()).defaultPrevented).toBe(true);
  });

  it("stops responding once torn down", () => {
    const onFile = vi.fn();
    const target = new EventTarget();
    attachVideoDropListeners(target, onFile)();
    dispatchDrop(target, clip());
    expect(onFile).not.toHaveBeenCalled();
  });
});

describe("isVideoDropEnabled", () => {
  it("is on for the dev server regardless of the developer switch", () => {
    expect(isVideoDropEnabled(true, false)).toBe(true);
  });

  it("is on in production once developer options are on", () => {
    expect(isVideoDropEnabled(false, true)).toBe(true);
  });

  it("is off in production with developer options off", () => {
    expect(isVideoDropEnabled(false, false)).toBe(false);
  });
});
