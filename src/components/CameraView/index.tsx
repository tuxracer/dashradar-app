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
   * Show the whole feed instead of keeping the element a hidden pixel. Fits
   * rather than fills, so no part of the frame the model was handed is cropped
   * off the screen.
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

  // Subscribed once per mount, with handlers read through refs so a fresh
  // callback identity cannot restart it: resubscribing stops and reacquires the
  // camera, a visible stutter no mere re-render should cause.
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

  // Shrunk to a single pixel rather than only made transparent: a transparent
  // full-screen video is still composited every frame for nobody to see. Capture
  // reads intrinsic dimensions, which CSS size does not touch. It stays rendered,
  // since a video that is not stops delivering frames on some platforms.
  return (
    <video
      ref={videoRef}
      data-testid="camera-view"
      autoPlay
      muted
      playsInline
      className={
        visible
          ? "h-full w-full object-contain"
          : "pointer-events-none absolute left-0 top-0 h-px w-px opacity-0"
      }
    />
  );
};
