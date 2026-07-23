import { useEffect, useRef } from "react";
import type { CameraError } from "@/lib/camera";
import { CameraError as CameraErrorClass } from "@/lib/camera";

type DevVideoViewProps = {
  /** URL of the dev clip served by the devVideo Vite plugin. */
  src: string;
  onStream: (video: HTMLVideoElement) => void;
  onError: (error: CameraError) => void;
  /** Fires when the video's intrinsic dimensions change; mirrors CameraView. */
  onVideoResize?: (video: HTMLVideoElement) => void;
};

/**
 * Dev-only stand-in for CameraView: plays a local video file (served at
 * DEV_VIDEO_URL) as the detection feed. The same element doubles as a visible
 * corner player with native controls, so the clip can be paused and scrubbed;
 * capture reads the full intrinsic resolution regardless of display size.
 * This mode only ever runs on a desktop browser, so the player is sized for
 * mouse use, not for the dash-mount touch-target rules. Pausing legitimately
 * stops new frames; DetectionContext disables the camera-stall machinery in
 * dev video mode so that never triggers recovery.
 */
export const DevVideoView = ({
  src,
  onStream,
  onError,
  onVideoResize,
}: DevVideoViewProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    let cancelled = false;
    const handleVideoResize = () => {
      onVideoResize?.(video);
    };
    const startPlayback = async () => {
      try {
        await video.play();
        if (cancelled) {
          return;
        }
        onStream(video);
        video.addEventListener("resize", handleVideoResize);
      } catch {
        if (!cancelled) {
          onError(new CameraErrorClass("NO_CAMERA"));
        }
      }
    };
    void startPlayback();
    return () => {
      cancelled = true;
      video.removeEventListener("resize", handleVideoResize);
    };
  }, [onStream, onError, onVideoResize]);

  return (
    <video
      ref={videoRef}
      src={src}
      controls
      loop
      muted
      autoPlay
      playsInline
      className="fixed bottom-4 left-4 z-20 w-[480px] max-w-[40vw] rounded-lg border border-white/20 shadow-lg"
    />
  );
};
