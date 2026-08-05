/**
 * Why a video-file feed ended. A file's `video/*` type is the operating
 * system's word, not the browser's: ProRes .mov, H.265 .mp4, and .mkv all
 * pass the drop filter and none of them decode, so the file the user handed
 * over failing to play is the only way this feed can end on its own.
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
 * vocabulary so one consumer handles either source: `active` once the clip is
 * playing (the moment frames can be captured from it), then `resize` whenever
 * the element's intrinsic dimensions change. Failures are not events; they
 * surface as a typed VideoFileError on the error channel, terminally.
 */
export type VideoFileFeedEvent =
  | { type: "active"; video: HTMLVideoElement }
  | { type: "resize"; video: HTMLVideoElement };
