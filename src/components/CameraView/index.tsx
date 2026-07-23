import { useEffect, useRef } from "react";
import type { CameraError } from "@/lib/camera";
import {
  getCameraStream,
  isCameraError,
  CameraError as CameraErrorClass,
} from "@/lib/camera";

type CameraViewProps = {
  onStream: (video: HTMLVideoElement) => void;
  onError: (error: CameraError) => void;
  /**
   * Fires whenever the video element's intrinsic dimensions change (the
   * `resize` event) — e.g. a phone rotates and the camera track swaps its
   * width/height. Lets callers keep aspect-ratio-dependent layout in sync
   * without a reload.
   */
  onVideoResize?: (video: HTMLVideoElement) => void;
};

export const CameraView = ({
  onStream,
  onError,
  onVideoResize,
}: CameraViewProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    let stream: MediaStream | undefined;
    let cancelled = false;

    const handleVideoResize = () => {
      onVideoResize?.(video);
    };

    const startCamera = async () => {
      try {
        stream = await getCameraStream();
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        onStream(video);
        video.addEventListener("resize", handleVideoResize);
      } catch (error) {
        if (!cancelled) {
          onError(
            isCameraError(error) ? error : new CameraErrorClass("NO_CAMERA"),
          );
        }
      }
    };

    void startCamera();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      video.removeEventListener("resize", handleVideoResize);
    };
  }, [onStream, onError, onVideoResize]);

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      className="h-full w-full object-cover opacity-0"
    />
  );
};
