import { CAMERA_CONSTRAINTS } from "./consts";
import { CameraError } from "./types";

export * from "./consts";
export * from "./types";

const toCameraError = (error: unknown): CameraError => {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
      case "SecurityError":
        return new CameraError("PERMISSION_DENIED");
      case "NotFoundError":
      case "OverconstrainedError":
        return new CameraError("NO_CAMERA");
      case "NotReadableError":
      case "AbortError":
        return new CameraError("CAMERA_IN_USE");
    }
  }
  return new CameraError("NO_CAMERA");
};

/**
 * Resolve when the video presents a camera frame newer than the last one, via
 * `requestVideoFrameCallback`. Waiting on this before capturing guarantees
 * inference never runs twice on the same camera frame (possible when the
 * detection rate outpaces the camera, e.g. very low light dropping the camera's
 * frame rate). On browsers without rVFC it resolves immediately, degrading to
 * capture-whatever-is-displayed. Note rVFC does not fire while the page is
 * hidden or the video is stalled, so a caller awaiting this can stay pending
 * indefinitely; callers must tolerate never resuming (the detection pump's
 * generation guard discards the stale continuation).
 */
export const waitForNextVideoFrame = (video: HTMLVideoElement): Promise<void> =>
  new Promise((resolve) => {
    if (typeof video.requestVideoFrameCallback !== "function") {
      resolve();
      return;
    }
    video.requestVideoFrameCallback(() => {
      resolve();
    });
  });

/** Open the rear camera (or any webcam on desktop) as a MediaStream. */
export const getCameraStream = async (): Promise<MediaStream> => {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError("UNSUPPORTED");
  }
  try {
    return await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
  } catch (error) {
    throw toCameraError(error);
  }
};
