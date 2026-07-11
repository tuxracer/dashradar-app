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
