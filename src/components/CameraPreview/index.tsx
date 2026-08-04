import { useEffect, useRef } from "react";
import type { ZoomLevel } from "@/workers/detection/types";

/** Props for CameraPreview. */
type CameraPreviewProps = {
  /**
   * The hidden CameraView element the detector captures frames from. The
   * preview plays that element's MediaStream in a second video element, so
   * the capture path is untouched and the preview can be sized and placed
   * independently of the source, which is itself only a hidden pixel.
   */
  source: HTMLVideoElement;
  /**
   * Crop factor the next capture scans at (ZOOM_OFF or ZOOM_2X). The preview
   * narrows to the same region.
   */
  zoom: ZoomLevel;
};

/**
 * Developer-only live view of exactly what the detector is scanning, for
 * checking aim and framing on a dash mount without leaving the meter. Shows
 * the model's capture region rather than the whole feed, mirroring the
 * worker's centerCropRegion: the square container's object-cover video shows
 * the largest centered square of the frame, and scaling the video by the crop
 * factor narrows that to the centered 1/zoom region the 2x digital zoom
 * actually samples. Sits clear of the rest of the HUD: on the left edge in
 * landscape, mirroring the contact card on the right, and top center under
 * the status-bar pills in portrait, clear of the portrait contact card at the
 * bottom. pointer-events are disabled so the meter underneath stays
 * interactive. The preview plays the source element's own MediaStream, so the
 * capture path is untouched.
 */
export const CameraPreview = ({ source, zoom }: CameraPreviewProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    const stream = source.srcObject;
    if (!video || !stream) {
      return;
    }
    video.srcObject = stream;
    video.play().catch(() => {
      // Muted autoplay of a live stream is reliable; a rejection here means
      // the element unmounted mid-play() and there is nothing to recover.
    });
    return () => {
      video.srcObject = null;
    };
  }, [source]);

  return (
    <div
      data-testid="camera-preview"
      className="pointer-events-none absolute left-[4%] top-1/2 aspect-square w-[24%] -translate-y-1/2 overflow-hidden rounded-lg border border-hud-amber/40 bg-surface/90 portrait:left-1/2 portrait:top-[calc(max(0.75rem,env(safe-area-inset-top))_+_3.5rem)] portrait:w-[56%] portrait:-translate-x-1/2 portrait:translate-y-0"
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="h-full w-full object-cover transition-transform duration-300"
        style={{ transform: `scale(${zoom})` }}
      />
    </div>
  );
};
