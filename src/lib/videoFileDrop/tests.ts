import { describe, expect, it } from "vitest";
import { pickVideoFile, videoFileDrops } from "@/lib/videoFileDrop";

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

/** Subscribes the drop stream on a fresh target and collects what it emits. */
const subscribeDrops = () => {
  const target = new EventTarget();
  const files: File[] = [];
  const subscription = videoFileDrops(target).subscribe((file) => {
    files.push(file);
  });
  return { target, files, subscription };
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

describe("videoFileDrops", () => {
  it("emits a dropped video file", () => {
    const { target, files } = subscribeDrops();
    const video = clip();
    dispatchDrop(target, video);
    expect(files).toEqual([video]);
  });

  it("emits nothing for a drop that carries no video", () => {
    const { target, files } = subscribeDrops();
    dispatchDrop(target, photo());
    expect(files).toEqual([]);
  });

  it("cancels dragover so the browser accepts the drag", () => {
    const { target } = subscribeDrops();
    const event = new Event("dragover", { cancelable: true });
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("cancels the drop itself, so the browser does not navigate to the file", () => {
    const { target } = subscribeDrops();
    expect(dispatchDrop(target, clip()).defaultPrevented).toBe(true);
  });

  it("stops listening once unsubscribed", () => {
    const { target, files, subscription } = subscribeDrops();
    subscription.unsubscribe();
    const event = new Event("dragover", { cancelable: true });
    target.dispatchEvent(event);
    dispatchDrop(target, clip());
    expect(files).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it("keeps listening after a drag that carried nothing it wanted", () => {
    const { target, files } = subscribeDrops();
    dispatchDrop(target, photo());
    const video = clip();
    dispatchDrop(target, video);
    expect(files).toEqual([video]);
  });
});
