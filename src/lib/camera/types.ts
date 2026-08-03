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
 * What the camera feed reports while it is up: `active` once the stream is
 * attached and playing (the moment consumers may start capturing frames),
 * then `resize` whenever the element's intrinsic dimensions change (a phone
 * rotates and the camera track swaps its width and height). Failures are
 * not events: they surface as typed CameraError on the observable's error
 * channel, terminally. Future camera features (stall states, feed swaps)
 * add members here without changing any consumer signature.
 */
export type CameraFeedEvent =
  | { type: "active"; video: HTMLVideoElement }
  | { type: "resize"; video: HTMLVideoElement };
