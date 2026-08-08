/**
 * Why a video-file feed ended. A file's `video/*` type is the OS's word, not the
 * browser's, so plenty of files pass the drop filter and fail to decode.
 */
export type VideoFileErrorCode = "DECODE_FAILED";

export class VideoFileError extends Error {
  readonly code: VideoFileErrorCode;

  constructor(code: VideoFileErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "VideoFileError";
    this.code = code;
  }
}

export const isVideoFileError = (error: unknown): error is VideoFileError => {
  return error instanceof VideoFileError;
};

/**
 * What a video-file feed reports while it is up, matching the camera feed's
 * vocabulary so one consumer handles either source. Failures are not events;
 * they surface terminally as a VideoFileError on the error channel.
 */
export type VideoFileFeedEvent =
  | { type: "active"; video: HTMLVideoElement }
  | { type: "resize"; video: HTMLVideoElement };
