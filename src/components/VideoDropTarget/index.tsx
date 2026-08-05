import { useEffect, useRef } from "react";
import { useVideoSource } from "@/context/VideoSourceContext";
import { videoFileDrops } from "@/lib/videoFileDrop";

/**
 * Renders nothing; subscribes the whole window to video files dropped onto the
 * app. Mounted beside RadarScreen rather than inside it because RadarScreen
 * returns early for the intro, permission, and error screens, and dropping a
 * clip on those is exactly how a machine with no camera, or a denied one, gets
 * a working session.
 *
 * Ungated: dropping a clip works without Developer options. Dragging a file
 * onto the window is a deliberate desktop gesture that no phone can perform,
 * so it cannot happen by accident on a dash mount.
 */
export const VideoDropTarget = () => {
  const { setVideoFile } = useVideoSource();

  // The window is subscribed once per mount and the setter is read through a
  // ref, so a parent render cannot detach and reattach the listeners; a drop
  // landing in that gap would navigate the browser to the file and end the
  // session.
  const setVideoFileRef = useRef(setVideoFile);
  useEffect(() => {
    setVideoFileRef.current = setVideoFile;
  });

  useEffect(() => {
    const subscription = videoFileDrops(window).subscribe((file) => {
      setVideoFileRef.current(file);
    });
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return null;
};
