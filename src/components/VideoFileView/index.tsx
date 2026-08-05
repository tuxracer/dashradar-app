import { useEffect, useRef, useState } from "react";
import type { VideoFileFeedEvent } from "@/lib/videoFileFeed";
import { videoFileFeed } from "@/lib/videoFileFeed";

type VideoFileViewProps = {
  /** Object URL of the file dropped onto the window or picked in settings. */
  src: string;
  /**
   * Feed lifecycle events, matching CameraView's: `active` once the clip is
   * playing (the element is ready to capture from), `resize` on
   * intrinsic-dimension changes.
   */
  onEvent: (event: VideoFileFeedEvent) => void;
  /**
   * The browser could not decode the file, so it will never present a frame.
   * The caller puts the camera back rather than leaving the pump waiting on a
   * feed that cannot deliver.
   */
  onError: () => void;
  /**
   * Fills the viewport instead of playing in the corner, so the detection
   * view's boxes map onto the clip the same way they map onto the camera.
   * object-cover crops the clip's edges, which is the price of one mapping
   * that fits both feeds. The native controls stay either way.
   */
  fullScreen?: boolean;
};

/**
 * Stand-in for CameraView: plays a video file as the detection feed. All the
 * playback lifecycle lives in the feed stream (src/lib/videoFileFeed); this
 * component owns the element, forwards the stream's events into React, and
 * sizes the player.
 *
 * The same element doubles as a visible player with native controls so the
 * clip can be paused and scrubbed, sized for mouse use rather than the
 * dash-mount touch-target rules, since a drag-and-drop or file picker put it
 * there. Capture reads the element's full intrinsic resolution regardless of
 * how small it is drawn. It stays invisible until the clip is actually
 * playing, so a swap never flashes a black rectangle over the meter.
 */
export const VideoFileView = ({
  src,
  onEvent,
  onError,
  fullScreen = false,
}: VideoFileViewProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  // Subscribed once per src, with the handlers read through refs: a parent
  // passing fresh callback identities on a render must not tear the clip down
  // and reload it from the start.
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
    setPlaying(false);
    const subscription = videoFileFeed(video, src).subscribe({
      next: (event) => {
        if (event.type === "active") {
          setPlaying(true);
        }
        onEventRef.current(event);
      },
      error: (error: unknown) => {
        console.error("video file feed failed", error);
        onErrorRef.current();
      },
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [src]);

  return (
    <video
      ref={videoRef}
      data-testid="video-file-view"
      controls
      loop
      muted
      preload="auto"
      playsInline
      className={`${
        fullScreen
          ? "fixed inset-0 h-full w-full object-cover"
          : "fixed bottom-4 left-4 z-20 w-[480px] max-w-[40vw] rounded-lg border border-white/20 shadow-lg"
      } ${playing ? "" : "invisible"}`}
    />
  );
};
