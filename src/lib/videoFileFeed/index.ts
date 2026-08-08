import { Observable } from "rxjs";
import { VideoFileError, VideoFileFeedEvent } from "./types";

export * from "./types";

/**
 * A local video file as the detection feed. Unsubscribing is the whole teardown,
 * so a second clip dropped on a playing one cannot leave the first decoding.
 * `active` comes from the `playing` event rather than the play() promise, so
 * whichever call actually started the clip reports it. An undecodable file errors
 * the stream so the caller can put the camera back, rather than parking the pump
 * while the meter still reads SCANNING.
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
