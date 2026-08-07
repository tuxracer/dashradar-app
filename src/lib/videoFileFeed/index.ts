import { Observable } from "rxjs";
import { VideoFileError, VideoFileFeedEvent } from "./types";

export * from "./types";

/**
 * A local video file as the detection feed. Subscribing points `video` at `url`
 * and starts it, emits `active` once frames are coming, then a `resize` per
 * dimension change; unsubscribing is the whole teardown, so a second clip
 * dropped on a playing one cannot leave the first decoding behind it.
 *
 * `active` comes from the `playing` event rather than the play() promise, so
 * whichever call actually started the clip reports it, including one made on the
 * native controls after an autoplay refusal. Pausing is left alone: frames stop,
 * which pauses detection, and playing resumes.
 *
 * An undecodable file errors the stream so the caller can put the camera back.
 * Leaving it would park the pump on a frame callback that never fires while the
 * meter reads SCANNING, the failure this app refuses everywhere else.
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
      // Not the failure path: an undecodable file reports itself terminally
      // through the error event above. What lands here is a refused or
      // interrupted start, which the native controls recover from, and teardown
      // itself interrupts a pending play().
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
      // Two steps: removing the attribute alone leaves the element decoding what
      // it loaded, and assigning "" points it at the page URL and fails as an
      // error.
      video.removeAttribute("src");
      video.load();
    };
  });
