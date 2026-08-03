import { Observable } from "rxjs";
import { CAMERA_CONSTRAINTS } from "./consts";
import { CameraError, CameraFeedEvent, isCameraError } from "./types";

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
 * capture observable is torn down by unsubscription when scanning stops,
 * abandoning the wait).
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

/**
 * The camera acquisition lifecycle as a stream: subscribing opens the rear
 * camera, attaches it to the element, starts playback, emits `active`, and
 * then a `resize` event per intrinsic-dimension change. Unsubscribing is
 * the whole teardown: tracks stop and the listener detaches, and a
 * getUserMedia grant or play() that resolves after unsubscription is
 * disposed instead of committed (every await re-checks cancellation). The
 * stream never completes on its own; it ends by unsubscription or by a
 * terminal typed CameraError on the error channel.
 */
export const cameraFeed = (
  video: HTMLVideoElement,
): Observable<CameraFeedEvent> =>
  new Observable<CameraFeedEvent>((subscriber) => {
    let cancelled = false;
    let stream: MediaStream | undefined;
    const handleResize = () => {
      subscriber.next({ type: "resize", video });
    };
    void (async () => {
      try {
        const acquired = await getCameraStream();
        if (cancelled) {
          for (const track of acquired.getTracks()) {
            track.stop();
          }
          return;
        }
        stream = acquired;
        video.srcObject = acquired;
        await video.play();
        if (cancelled) {
          return;
        }
        subscriber.next({ type: "active", video });
        video.addEventListener("resize", handleResize);
      } catch (error) {
        if (!cancelled) {
          subscriber.error(
            isCameraError(error) ? error : new CameraError("NO_CAMERA"),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => {
        track.stop();
      });
      video.removeEventListener("resize", handleResize);
    };
  });
