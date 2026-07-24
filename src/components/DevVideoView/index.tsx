import { useEffect, useRef, useState } from "react";

type DevVideoViewProps = {
  /** URL of the dev clip served by the devVideo Vite plugin. */
  src: string;
  onStream: (video: HTMLVideoElement) => void;
  /** Fires when the video's intrinsic dimensions change; mirrors CameraView. */
  onVideoResize?: (video: HTMLVideoElement) => void;
  /**
   * True while detection is running. The first rising edge starts playback;
   * later transitions never auto-play or auto-pause, since the video is the
   * user's to control by then.
   */
  scanning: boolean;
};

/**
 * Dev-only stand-in for CameraView: plays a local video file (served at
 * DEV_VIDEO_URL) as the detection feed. The same element doubles as a visible
 * corner player with native controls, so the clip can be paused and scrubbed;
 * capture reads the full intrinsic resolution regardless of display size.
 * This mode only ever runs on a desktop browser, so the player is sized for
 * mouse use, not for the dash-mount touch-target rules. Pausing legitimately
 * stops new frames; DetectionContext disables the camera-stall machinery in
 * dev video mode so that never triggers recovery. Playback does not start on
 * mount: it waits for the first `scanning` transition so the clip's opening
 * seconds aren't consumed while the model is still downloading or compiling.
 * The player is also kept invisible until that same transition, so the load
 * and compile phase shows only the radar backdrop, matching the camera path.
 * Camera errors do not exist in this mode: a rejected play() just logs to the
 * console, and the already-visible native controls are the manual recovery.
 */
export const DevVideoView = ({
  src,
  onStream,
  onVideoResize,
  scanning,
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
    video.play().catch((error: unknown) => {
      console.error("dev video playback failed", error);
    });
  }, [scanning]);

  return (
    <video
      ref={videoRef}
      src={src}
      controls
      loop
      muted
      preload="auto"
      playsInline
      className={`fixed bottom-4 left-4 z-20 w-[480px] max-w-[40vw] rounded-lg border border-white/20 shadow-lg ${
        started ? "" : "invisible"
      }`}
    />
  );
};
