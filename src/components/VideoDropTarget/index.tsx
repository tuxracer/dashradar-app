import { useEffect, useRef } from "react";
import { useSettings } from "@/context/SettingsContext";
import { useVideoSource } from "@/context/VideoSourceContext";
import { videoFileDrops } from "@/lib/videoFileDrop";

/**
 * Renders nothing; subscribes the window to video files dropped onto the app.
 * Beside RadarScreen rather than inside it, which returns early for the intro and
 * error screens, and dropping a clip on those is how a machine with no camera
 * gets a session. Taken only while Developer options are on, but the drag is
 * claimed and cancelled either way, since refusing it navigates the browser away.
 */
export const VideoDropTarget = () => {
  const { setVideoFile } = useVideoSource();
  const { developerOptions } = useSettings();

  // Subscribed once per mount with both values read through a ref, so a parent
  // render cannot detach the listeners: a drop landing in that gap would navigate
  // the browser to the file. That is also why the gate lives inside the handler.
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
