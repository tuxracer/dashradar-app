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
