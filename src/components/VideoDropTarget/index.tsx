import { useEffect } from "react";
import { useDetection } from "@/context/DetectionContext";
import { useSettings } from "@/context/SettingsContext";
import {
  attachVideoDropListeners,
  isVideoDropEnabled,
} from "@/lib/videoFileDrop";

/**
 * Renders nothing; installs window-level drag-and-drop of a video file onto
 * the app. Mounted beside RadarScreen rather than inside it because
 * RadarScreen returns early for the intro, permission, and error screens, and
 * dropping a clip on those is exactly how a machine with no camera (or a
 * denied one) gets a working session.
 */
export const VideoDropTarget = () => {
  const { developerOptions } = useSettings();
  const { swapVideoSource } = useDetection();
  const enabled = isVideoDropEnabled(import.meta.env.DEV, developerOptions);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    return attachVideoDropListeners(window, swapVideoSource);
  }, [enabled, swapVideoSource]);

  return null;
};
