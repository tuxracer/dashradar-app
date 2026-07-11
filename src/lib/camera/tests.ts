import { afterEach, describe, expect, it, vi } from "vitest";
import { getCameraStream, isCameraError } from "@/lib/camera";

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
