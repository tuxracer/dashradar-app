import { Observable } from "rxjs";
import { VideoFileError, VideoFileFeedEvent } from "./types";

export * from "./types";

/**
 * Playing a local video file as the detection feed, as a stream: subscribing
 * points `video` at `url` and starts it, emits `active` once frames are
 * actually coming, and then a `resize` per intrinsic-dimension change.
 * Unsubscribing is the whole teardown: playback stops and the element lets go
 * of the file, so a second clip dropped onto a playing one cannot leave the
 * first one decoding behind it.
 *
 * `active` comes from the element's `playing` event rather than the play()
 * promise, so whichever call actually started the clip is what reports it,
 * including one the user makes on the native controls after an autoplay
 * refusal. Pausing the clip is left alone: no more frames arrive, which pauses
 * detection with it, and playing again resumes.
 *
 * A file the browser cannot decode ends the stream with a VideoFileError so
 * the caller can put the camera back. Leaving it in place instead would park
 * the pump on a frame callback that never fires while the meter reads
 * SCANNING, which is the failure this app refuses everywhere else: a detector
 * that never scans while looking like it works.
 */
export const videoFileFeed = (
  video: HTMLVideoElement,
  url: string,
): Observable<VideoFileFeedEvent> =>
  new Observable<VideoFileFeedEvent>((subscriber) => {
    let cancelled = false;
    const handleResize = () => {
      subscriber.next({ type: "resize", video });
    };
    const handlePlaying = () => {
      subscriber.next({ type: "active", video });
      video.addEventListener("resize", handleResize);
    };
    const handleError = () => {
      subscriber.error(
        new VideoFileError("DECODE_FAILED", video.error?.message),
      );
    };
    video.addEventListener("playing", handlePlaying, { once: true });
    video.addEventListener("error", handleError);

    video.src = url;
    video.play().catch((error: unknown) => {
      // Not the failure path: a file that cannot be decoded reports itself
      // through the element's error event above, terminally. What lands here
      // is a refused or interrupted start, which the native controls on the
      // player recover from, so it is logged rather than acted on. The
      // teardown itself interrupts a pending play(), and that rejection is
      // this subscription being disposed rather than anything to report.
      if (!cancelled) {
        console.error("video file playback failed", error);
      }
    });

    return () => {
      cancelled = true;
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("resize", handleResize);
      video.removeEventListener("error", handleError);
      video.pause();
      // Detaching the file takes two steps: removing the attribute alone
      // leaves the element decoding what it already loaded, and assigning ""
      // would point it at the page URL and fail that load as a real error.
      video.removeAttribute("src");
      video.load();
    };
  });
