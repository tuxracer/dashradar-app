import { useEffect, useRef } from "react";
import type { CameraError, CameraFeedEvent } from "@/lib/camera";
import {
  cameraFeed,
  isCameraError,
  CameraError as CameraErrorClass,
} from "@/lib/camera";

type CameraViewProps = {
  /**
   * Feed lifecycle events: `active` once the stream plays (the element is
   * ready to capture from), `resize` on intrinsic-dimension changes.
   */
  onEvent: (event: CameraFeedEvent) => void;
  /** Terminal acquisition failure; the feed reports nothing after it. */
  onError: (error: CameraError) => void;
  /**
   * Shows the feed instead of keeping the element transparent. Only the
   * detection view developer option sets it: the app otherwise never puts the
   * camera on screen.
   */
  visible?: boolean;
};

/**
 * Owns the hidden `<video>` element and subscribes it to the camera feed
 * stream (src/lib/camera's cameraFeed). All acquisition, cancellation, and
 * teardown logic lives in the stream; this component only forwards its
 * events to React, and the effect cleanup's unsubscribe is the teardown.
 */
export const CameraView = ({
  onEvent,
  onError,
  visible = false,
}: CameraViewProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  // The feed is subscribed once per mount, and the handlers are read through
  // refs so a parent passing a fresh callback identity on a render cannot
  // restart it: resubscribing stops the camera and reacquires it, a
  // user-visible stutter (and on some platforms a fresh permission hit) that
  // no mere re-render should cause.
  const onEventRef = useRef(onEvent);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onEventRef.current = onEvent;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const subscription = cameraFeed(video).subscribe({
      next: (event) => {
        onEventRef.current(event);
      },
      error: (error: unknown) => {
        onErrorRef.current(
          isCameraError(error) ? error : new CameraErrorClass("NO_CAMERA"),
        );
      },
    });
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return (
    <video
      ref={videoRef}
      data-testid="camera-view"
      autoPlay
      muted
      playsInline
      className={`h-full w-full object-cover ${visible ? "" : "opacity-0"}`}
    />
  );
};
