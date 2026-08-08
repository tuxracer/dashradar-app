export type CameraErrorCode =
  | "PERMISSION_DENIED"
  | "NO_CAMERA"
  | "CAMERA_IN_USE"
  | "UNSUPPORTED";

export class CameraError extends Error {
  readonly code: CameraErrorCode;

  constructor(code: CameraErrorCode) {
    super(code);
    this.name = "CameraError";
    this.code = code;
  }
}

export const isCameraError = (error: unknown): error is CameraError => {
  return error instanceof CameraError;
};

/**
 * What the camera feed reports while it is up: `active` once frames can be
 * captured, then `resize` whenever the element's intrinsic dimensions change.
 * Failures are not events; they surface terminally as a typed CameraError.
 */
export type CameraFeedEvent =
  | { type: "active"; video: HTMLVideoElement }
  | { type: "resize"; video: HTMLVideoElement };
