import { useEffect, useRef } from "react";
import { isFunction } from "remeda";
import type { ZoomLevel } from "@/workers/detection/types";

/**
 * A video element that can mirror its playback into a MediaStream. captureStream
 * is Chromium-only and absent from TypeScript's DOM lib, so the file feed
 * narrows to it through this guard.
 */
type CaptureStreamVideo = HTMLVideoElement & {
  captureStream: () => MediaStream;
};

const hasCaptureStream = (
  video: HTMLVideoElement,
): video is CaptureStreamVideo =>
  isFunction((video as Partial<CaptureStreamVideo>).captureStream);

type CameraPreviewProps = {
  /**
   * The hidden element the detector captures from. Its stream is played in a
   * second video element, so the capture path is untouched and the preview can be
   * sized independently of a source that is itself a hidden pixel.
   */
  source: HTMLVideoElement;
  /** Crop factor the next capture scans at; the preview narrows to match. */
  zoom: ZoomLevel;
};

/**
 * Developer-only live view of the region the detector scans, for checking aim on
 * a dash mount without leaving the meter. An object-cover video in a square
 * container is the largest centered square, and scaling by the crop factor
 * narrows that to what the zoom samples.
 *
 * A file feed plays a file rather than a stream, so it mirrors through
 * captureStream, which is Chromium only; on WebKit the preview stays empty.
 */
export const CameraPreview = ({ source, zoom }: CameraPreviewProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    // Ownership follows creation: a minted stream's tracks are stopped on
    // teardown or the capture tap outlives the preview, while a borrowed one
    // belongs to the engine and must be left running.
    const minted =
      !source.srcObject && hasCaptureStream(source)
        ? source.captureStream()
        : null;
    const stream = source.srcObject ?? minted;
    if (!stream) {
      return;
    }
    video.srcObject = stream;
    video.play().catch(() => {
      // Muted autoplay of a live stream is reliable, so a rejection means the
      // element unmounted mid-play() and there is nothing to recover.
    });
    return () => {
      video.srcObject = null;
      if (minted) {
        for (const track of minted.getTracks()) {
          track.stop();
        }
      }
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
