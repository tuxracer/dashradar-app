import { useEffect, useRef } from "react";

/** Props for CameraPreview. */
type CameraPreviewProps = {
  /**
   * The hidden CameraView element the detector captures frames from. The
   * preview plays that element's MediaStream in a second video element, so
   * the capture path is untouched and the preview can be sized and placed
   * independently of the full-viewport source.
   */
  source: HTMLVideoElement;
};

/**
 * Developer-only live view of the feed the detector is scanning, for checking
 * aim and exposure on a dash mount without leaving the meter. Sits clear of
 * the rest of the HUD: on the left edge in landscape, mirroring the contact
 * card on the right, and top center under the status-bar pills in portrait,
 * clear of the portrait contact card at the bottom. pointer-events are
 * disabled so the meter underneath stays interactive. Mounted only on the
 * real camera path; dev video mode already shows its clip in a corner player.
 */
export const CameraPreview = ({ source }: CameraPreviewProps) => {
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
      className="pointer-events-none absolute left-[4%] top-1/2 w-[24%] -translate-y-1/2 overflow-hidden rounded-lg border border-hud-amber/40 bg-surface/90 portrait:left-1/2 portrait:top-[calc(max(0.75rem,env(safe-area-inset-top))_+_3.5rem)] portrait:w-[56%] portrait:-translate-x-1/2 portrait:translate-y-0"
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="block w-full"
      />
    </div>
  );
};
