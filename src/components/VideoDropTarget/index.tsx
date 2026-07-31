import { useEffect } from "react";
import { useDetection } from "@/context/DetectionContext";
import { attachVideoDropListeners } from "@/lib/videoFileDrop";

/**
 * Renders nothing; installs window-level drag-and-drop of a video file onto
 * the app. Mounted beside RadarScreen rather than inside it because
 * RadarScreen returns early for the intro, permission, and error screens, and
 * dropping a clip on those is exactly how a machine with no camera (or a
 * denied one) gets a working session.
 *
 * Ungated: dropping a clip works in production without Developer options.
 * Dragging a file onto the window is a deliberate desktop gesture that no
 * phone can perform, so it cannot happen by accident on a dash mount, and the
 * settings Video file row appears on its own while a clip is playing so CLEAR
 * is always within reach.
 */
export const VideoDropTarget = () => {
  const { swapVideoSource } = useDetection();

  useEffect(
    () => attachVideoDropListeners(window, swapVideoSource),
    [swapVideoSource],
  );

  return null;
};
