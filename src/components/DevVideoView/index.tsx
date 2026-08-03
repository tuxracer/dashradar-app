import { useEffect, useRef, useState } from "react";

type DevVideoViewProps = {
  /**
   * Object URL of the file dropped onto the window or picked from Developer
   * options.
   */
  src: string;
  onStream: (video: HTMLVideoElement) => void;
  /** Fires when the video's intrinsic dimensions change; mirrors CameraView. */
  onVideoResize?: (video: HTMLVideoElement) => void;
  /**
   * Fires when the browser cannot load or decode the file, so the caller can
   * put the feed back. A file's `video/*` MIME type is the OS's word, not the
   * browser's: ProRes .mov, H.265 .mp4, and .mkv all pass the pick filter and
   * none of them decode. Such a file never presents a frame, and the pump
   * would wait on a frame callback that never fires while the meter reads
   * SCANNING.
   */
  onError?: () => void;
  /**
   * True while detection is running. The first rising edge starts playback;
   * later transitions never auto-play or auto-pause, since the video is the
   * user's to control by then.
   */
  scanning: boolean;
  /**
   * Fills the viewport instead of playing in the corner, so the detection
   * view's boxes map onto the clip the same way they map onto the camera.
   * object-cover crops the clip's edges, which is the price of one mapping
   * that fits both feeds. Native controls stay, so scrubbing still works.
   */
  fullScreen?: boolean;
};

/**
 * True for the AbortError a play() rejects with when the element's own
 * pending load interrupts it, as opposed to a refused or failed playback.
 */
const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";

/**
 * Stand-in for CameraView: plays a video file as the detection feed instead
 * of the camera. Renders whenever DevVideoContext hands back a source, which
 * means a file was dropped onto the window or picked from the settings Video
 * file row; the row ships in production and works on a phone, though dragging
 * a file onto the window is a desktop-only gesture. The same element doubles
 * as a visible corner player with native controls, sized for mouse use
 * rather than the
 * dash-mount touch-target rules, so the clip can be paused and scrubbed;
 * capture reads the full intrinsic resolution regardless of display size.
 * Pausing legitimately stops new frames, which simply pauses detection with
 * it. Playback does not start on mount: it waits for the
 * first `scanning` transition so the clip's opening seconds aren't consumed
 * while the model is still downloading or compiling. The player is also kept
 * invisible until that same transition, so the load and compile phase shows
 * only the radar backdrop, matching the camera path. Camera errors do not
 * exist in this mode, but a file the browser cannot decode does: the element's
 * `error` event reports it through onError so the caller can put the feed
 * back. A play() the element's own pending load interrupts is retried once
 * on canplay, so a clip never sits paused because it lost that race; any
 * other rejection only logs, with the visible native controls as the manual
 * recovery.
 */
export const DevVideoView = ({
  src,
  onStream,
  onVideoResize,
  onError,
  scanning,
  fullScreen = false,
}: DevVideoViewProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const startedRef = useRef(false);
  // Render-facing mirror of startedRef: the player stays invisible until the
  // first scanning transition, the same edge that starts playback.
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    let cancelled = false;
    const handleVideoResize = () => {
      if (!cancelled) {
        onVideoResize?.(video);
      }
    };
    video.addEventListener("resize", handleVideoResize);
    onStream(video);
    return () => {
      cancelled = true;
      video.removeEventListener("resize", handleVideoResize);
    };
  }, [onStream, onVideoResize]);

  // The element's error event is the only path to onError. A rejected play()
  // observes the same undecodable file a second time, but it also rejects when
  // the element is torn down mid-play, so reporting from there would swap the
  // feed twice on one failure and could clear a clip the user had just picked.
  // reportedRef keeps that promise across effect re-runs: this element's
  // failure is terminal, so it is worth reporting exactly once.
  const reportedRef = useRef(false);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const handleError = () => {
      if (reportedRef.current) {
        return;
      }
      reportedRef.current = true;
      console.error("dev video source failed to load", video.error?.message);
      onError?.();
    };
    // An error that landed before this effect ran leaves no event to catch,
    // only the element's error property, so read it once on attach.
    if (video.error) {
      handleError();
    }
    video.addEventListener("error", handleError);
    return () => video.removeEventListener("error", handleError);
  }, [onError]);

  // One-shot: start playback on the first rising edge of `scanning` only.
  // Later transitions (settings panel pausing the pump, page hidden, etc.)
  // must never auto-play or auto-pause a clip the user is now controlling.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !scanning || startedRef.current) {
      return;
    }
    startedRef.current = true;
    setStarted(true);
    let cancelled = false;
    let retried = false;
    const startPlayback = () => {
      video.play().catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        // A play() the element's own pending load interrupts rejects with
        // AbortError, which a freshly mounted player pointed at a new object
        // URL can lose the race to. The one-shot guard means nothing would
        // ever start the clip again, so retry once the element reports it can
        // play. Every other rejection is final (a real autoplay block, a
        // decode failure), and the visible native controls are the recovery.
        if (retried || !isAbortError(error)) {
          console.error("dev video playback failed", error);
          return;
        }
        retried = true;
        video.addEventListener("canplay", startPlayback, { once: true });
      });
    };
    startPlayback();
    return () => {
      cancelled = true;
      video.removeEventListener("canplay", startPlayback);
    };
  }, [scanning]);

  return (
    <video
      ref={videoRef}
      data-testid="dev-video-view"
      src={src}
      controls
      loop
      muted
      preload="auto"
      playsInline
      className={`${
        fullScreen
          ? "fixed inset-0 h-full w-full object-cover"
          : "fixed bottom-4 left-4 z-20 w-[480px] max-w-[40vw] rounded-lg border border-white/20 shadow-lg"
      } ${started ? "" : "invisible"}`}
    />
  );
};
