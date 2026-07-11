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
};

export const CameraView = ({ onStream, onError }: CameraViewProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    let stream: MediaStream | undefined;
    let cancelled = false;

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
    };
  }, [onStream, onError]);

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      className="h-full w-full object-cover"
    />
  );
};
