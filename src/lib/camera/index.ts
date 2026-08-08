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
 * Resolve when the video presents a frame newer than the last, so inference never
 * runs twice on one camera frame. Resolves immediately without rVFC. It does not
 * fire while the page is hidden or the video is stalled, so a caller can stay
 * pending forever and must tolerate never resuming.
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
 * The camera lifecycle as a stream: subscribing opens the rear camera, attaches
 * and plays it, emits `active`, then a `resize` per dimension change.
 * Unsubscribing is the whole teardown, and a grant resolving after it is disposed
 * rather than committed. Ends by unsubscription or a terminal CameraError.
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
      if (stream) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        // Detach the dead stream too, so the element neither shows a frozen
        // last frame nor holds a reference to it. Guarded by `stream`: only
        // the subscription that attached a stream may clear the element.
        video.srcObject = null;
      }
      video.removeEventListener("resize", handleResize);
    };
  });
