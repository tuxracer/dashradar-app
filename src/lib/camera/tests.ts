import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cameraFeed,
  getCameraStream,
  isCameraError,
  waitForNextVideoFrame,
} from "@/lib/camera";

const stubGetUserMedia = (impl: () => Promise<MediaStream>) => {
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: vi.fn(impl) },
  });
};

const domException = (name: string) => {
  return Promise.reject(new DOMException("denied", name));
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getCameraStream", () => {
  it("returns the stream and requests the environment camera", async () => {
    const fakeStream = { getTracks: () => [] } as unknown as MediaStream;
    stubGetUserMedia(() => Promise.resolve(fakeStream));
    const stream = await getCameraStream();
    expect(stream).toBe(fakeStream);
    const request = vi.mocked(navigator.mediaDevices.getUserMedia).mock
      .calls[0][0];
    expect(request).toMatchObject({
      audio: false,
      video: { facingMode: { ideal: "environment" } },
    });
  });

  it.each([
    ["NotAllowedError", "PERMISSION_DENIED"],
    ["SecurityError", "PERMISSION_DENIED"],
    ["NotFoundError", "NO_CAMERA"],
    ["OverconstrainedError", "NO_CAMERA"],
    ["NotReadableError", "CAMERA_IN_USE"],
    ["AbortError", "CAMERA_IN_USE"],
  ])("maps %s to %s", async (domError, code) => {
    stubGetUserMedia(() => domException(domError));
    const error = await getCameraStream().catch((caught: unknown) => caught);
    expect(isCameraError(error) && error.code).toBe(code);
  });

  it("throws UNSUPPORTED when mediaDevices is missing", async () => {
    vi.stubGlobal("navigator", {});
    const error = await getCameraStream().catch((caught: unknown) => caught);
    expect(isCameraError(error) && error.code).toBe("UNSUPPORTED");
  });
});

const FRAME_METADATA: VideoFrameCallbackMetadata = {
  presentationTime: 0,
  expectedDisplayTime: 0,
  width: 512,
  height: 512,
  mediaTime: 0,
  presentedFrames: 1,
};

describe("waitForNextVideoFrame", () => {
  it("resolves only once the video presents a new frame", async () => {
    const callbacks: VideoFrameRequestCallback[] = [];
    const video = document.createElement("video");
    video.requestVideoFrameCallback = (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    };
    let resolved = false;
    const wait = waitForNextVideoFrame(video).then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    callbacks[0](performance.now(), FRAME_METADATA);
    await wait;
    expect(resolved).toBe(true);
  });

  it("resolves immediately when rVFC is unsupported", async () => {
    // jsdom's video element has no requestVideoFrameCallback.
    const video = document.createElement("video");
    await expect(waitForNextVideoFrame(video)).resolves.toBeUndefined();
  });
});

describe("cameraFeed", () => {
  type FakeTrack = { stop: ReturnType<typeof vi.fn> };

  const fakeStreamWithTrack = () => {
    const track: FakeTrack = { stop: vi.fn() };
    const stream = {
      getTracks: () => [track],
    } as unknown as MediaStream;
    return { stream, track };
  };

  const stubGetUserMedia = (result: Promise<MediaStream>) => {
    const getUserMedia = vi.fn(() => result);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    return getUserMedia;
  };

  it("emits active with the video once the stream attaches and plays", async () => {
    const { stream } = fakeStreamWithTrack();
    stubGetUserMedia(Promise.resolve(stream));
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const video = document.createElement("video");
    const events: unknown[] = [];
    const subscription = cameraFeed(video).subscribe((event) => {
      events.push(event);
    });
    await vi.waitFor(() => {
      expect(events).toEqual([{ type: "active", video }]);
    });
    expect(video.srcObject).toBe(stream);
    subscription.unsubscribe();
  });

  it("emits a resize event per DOM resize after active", async () => {
    const { stream } = fakeStreamWithTrack();
    stubGetUserMedia(Promise.resolve(stream));
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const video = document.createElement("video");
    const events: Array<{ type: string }> = [];
    const subscription = cameraFeed(video).subscribe((event) => {
      events.push(event);
    });
    await vi.waitFor(() => {
      expect(events).toHaveLength(1);
    });
    video.dispatchEvent(new Event("resize"));
    expect(events).toEqual([
      { type: "active", video },
      { type: "resize", video },
    ]);
    subscription.unsubscribe();
  });

  it("errors with the typed CameraError from acquisition", async () => {
    stubGetUserMedia(
      Promise.reject(new DOMException("denied", "NotAllowedError")),
    );
    const video = document.createElement("video");
    const errors: unknown[] = [];
    cameraFeed(video).subscribe({
      next: () => {},
      error: (error: unknown) => {
        errors.push(error);
      },
    });
    await vi.waitFor(() => {
      expect(errors).toHaveLength(1);
    });
    const error = errors[0];
    expect(isCameraError(error) && error.code).toBe("PERMISSION_DENIED");
  });

  it("maps a play() rejection to a CameraError", async () => {
    const { stream } = fakeStreamWithTrack();
    stubGetUserMedia(Promise.resolve(stream));
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(
      new Error("interrupted"),
    );
    const video = document.createElement("video");
    const errors: unknown[] = [];
    cameraFeed(video).subscribe({
      next: () => {},
      error: (error: unknown) => {
        errors.push(error);
      },
    });
    await vi.waitFor(() => {
      expect(errors).toHaveLength(1);
    });
    const error = errors[0];
    expect(isCameraError(error) && error.code).toBe("NO_CAMERA");
  });

  it("stops tracks and silences resize on unsubscribe", async () => {
    const { stream, track } = fakeStreamWithTrack();
    stubGetUserMedia(Promise.resolve(stream));
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const video = document.createElement("video");
    const events: unknown[] = [];
    const subscription = cameraFeed(video).subscribe((event) => {
      events.push(event);
    });
    await vi.waitFor(() => {
      expect(events).toHaveLength(1);
    });
    subscription.unsubscribe();
    expect(track.stop).toHaveBeenCalled();
    video.dispatchEvent(new Event("resize"));
    expect(events).toHaveLength(1);
  });

  it("stops the tracks of a stream granted after unsubscribe", async () => {
    const { stream, track } = fakeStreamWithTrack();
    let grant: (granted: MediaStream) => void = () => {};
    stubGetUserMedia(
      new Promise<MediaStream>((resolve) => {
        grant = resolve;
      }),
    );
    const video = document.createElement("video");
    const events: unknown[] = [];
    const subscription = cameraFeed(video).subscribe((event) => {
      events.push(event);
    });
    subscription.unsubscribe();
    grant(stream);
    await vi.waitFor(() => {
      expect(track.stop).toHaveBeenCalled();
    });
    expect(events).toHaveLength(0);
    expect(video.srcObject).toBeUndefined();
  });

  it("emits nothing when play resolves after unsubscribe", async () => {
    const { stream } = fakeStreamWithTrack();
    stubGetUserMedia(Promise.resolve(stream));
    let finishPlay = () => {};
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishPlay = resolve;
        }),
    );
    const video = document.createElement("video");
    const events: unknown[] = [];
    const subscription = cameraFeed(video).subscribe((event) => {
      events.push(event);
    });
    await vi.waitFor(() => {
      expect(video.srcObject).toBe(stream);
    });
    subscription.unsubscribe();
    finishPlay();
    await Promise.resolve();
    expect(events).toHaveLength(0);
  });
});
