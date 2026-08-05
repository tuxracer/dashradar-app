import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isVideoFileError, videoFileFeed } from "@/lib/videoFileFeed";
import type { VideoFileFeedEvent } from "@/lib/videoFileFeed";

const CLIP_URL = "blob:mock/clip";

beforeEach(() => {
  // jsdom has no media playback at all: play, pause, and load all throw or
  // log without these.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Subscribes the feed on a fresh element and collects what it reports. */
const subscribeFeed = () => {
  const video = document.createElement("video");
  const events: VideoFileFeedEvent[] = [];
  const errors: unknown[] = [];
  const subscription = videoFileFeed(video, CLIP_URL).subscribe({
    next: (event) => events.push(event),
    error: (error: unknown) => errors.push(error),
  });
  return { video, events, errors, subscription };
};

describe("videoFileFeed", () => {
  it("points the element at the file and starts it", () => {
    const { video } = subscribeFeed();
    expect(video.getAttribute("src")).toBe(CLIP_URL);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it("reports active only once the clip is actually playing", () => {
    const { video, events } = subscribeFeed();
    expect(events).toEqual([]);
    video.dispatchEvent(new Event("playing"));
    expect(events).toEqual([{ type: "active", video }]);
  });

  it("reports a resize once the clip is playing", () => {
    const { video, events } = subscribeFeed();
    video.dispatchEvent(new Event("playing"));
    video.dispatchEvent(new Event("resize"));
    expect(events).toEqual([
      { type: "active", video },
      { type: "resize", video },
    ]);
  });

  // A video/* file the browser cannot decode (ProRes .mov, H.265 .mp4, .mkv)
  // passes the drop filter and then presents no frames at all, so the feed has
  // to say so rather than leave the pump waiting on it.
  it("ends with a typed error when the file cannot be decoded", () => {
    const { video, errors } = subscribeFeed();
    video.dispatchEvent(new Event("error"));
    expect(errors).toHaveLength(1);
    expect(isVideoFileError(errors[0])).toBe(true);
  });

  it("stops the clip and lets go of the file on unsubscription", () => {
    const { video, subscription } = subscribeFeed();
    video.dispatchEvent(new Event("playing"));
    subscription.unsubscribe();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(video.getAttribute("src")).toBeNull();
  });

  it("reports nothing after unsubscription", () => {
    const { video, events, errors, subscription } = subscribeFeed();
    subscription.unsubscribe();
    video.dispatchEvent(new Event("playing"));
    video.dispatchEvent(new Event("resize"));
    video.dispatchEvent(new Event("error"));
    expect(events).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("keeps quiet when the teardown interrupts a play that never started", async () => {
    const error = new DOMException("interrupted", "AbortError");
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(error);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { subscription } = subscribeFeed();
    subscription.unsubscribe();
    await Promise.resolve();
    expect(logged).not.toHaveBeenCalled();
  });
});
