import { useEffect, useRef } from "react";
import { useSettings } from "@/context/SettingsContext";
import { useVideoSource } from "@/context/VideoSourceContext";
import { videoFileDrops } from "@/lib/videoFileDrop";

/**
 * Renders nothing; subscribes the whole window to video files dropped onto the
 * app. Mounted beside RadarScreen rather than inside it because RadarScreen
 * returns early for the intro, permission, and error screens, and dropping a
 * clip on those is exactly how a machine with no camera, or a denied one, gets
 * a working session.
 *
 * A dropped clip is taken only while Developer options are on, matching the
 * settings row that names the clip and holds the only way back to the camera.
 * The drag is still claimed and cancelled with the switch off, though, because
 * refusing it hands the drop to the browser, which navigates away from the app.
 */
export const VideoDropTarget = () => {
  const { setVideoFile } = useVideoSource();
  const { developerOptions } = useSettings();

  // The window is subscribed once per mount and both values are read through a
  // ref, so a parent render cannot detach and reattach the listeners; a drop
  // landing in that gap would navigate the browser to the file and end the
  // session. That is also why the gate lives inside the handler rather than on
  // the subscription: unsubscribing would release the drag claim.
  const latest = useRef({ setVideoFile, developerOptions });
  useEffect(() => {
    latest.current = { setVideoFile, developerOptions };
  });

  useEffect(() => {
    const subscription = videoFileDrops(window).subscribe((file) => {
      if (!latest.current.developerOptions) {
        return;
      }
      latest.current.setVideoFile(file);
    });
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return null;
};
