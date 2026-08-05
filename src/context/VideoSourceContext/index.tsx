import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useDetection } from "@/context/DetectionContext";
import type { VideoSource, VideoSourceContextValue } from "./types";

export * from "./types";

const VideoSourceContext = createContext<VideoSourceContextValue | undefined>(
  undefined,
);

export const useVideoSource = (): VideoSourceContextValue => {
  const value = useContext(VideoSourceContext);
  if (!value) {
    throw new Error("useVideoSource must be used within a VideoSourceProvider");
  }
  return value;
};

/**
 * Owns which video file, if any, the detector scans instead of the camera.
 * Every session starts on the camera; a file dropped onto the window or picked
 * in settings replaces it until cleared. The choice cannot survive a reload:
 * object URLs die with the page and a File handle is not serializable.
 *
 * Sits inside DetectionProvider because every swap detaches the engine's video
 * first. The element the pump is capturing from is about to be unmounted, and
 * detaching stops the pump on the spot, which also drops the coasting tracker's
 * history: what the old feed was holding onto has nothing to do with the world
 * the new one is showing. Whichever view mounts for the new feed attaches it
 * again when it starts playing.
 */
export const VideoSourceProvider = ({ children }: { children: ReactNode }) => {
  const { detachVideo } = useDetection();
  // The selection and its id move together, in one state, because they have to
  // change together: a consumer that reads a new id beside the previous source
  // would drop live state on the feed it is still showing.
  const [feed, setFeed] = useState<{
    source: VideoSource | null;
    feedId: number;
  }>({ source: null, feedId: 0 });
  const { source, feedId } = feed;

  // Revoke the object URL of a source that has been replaced or cleared.
  // Cleanup runs after the next render commits, by which point the player
  // using the old URL has unmounted. Revoking inline in the setter would pull
  // the file out from under an element still on screen.
  useEffect(() => {
    if (!source) {
      return;
    }
    return () => URL.revokeObjectURL(source.url);
  }, [source]);

  const setVideoFile = useCallback(
    (file: File) => {
      detachVideo();
      setFeed((previous) => ({
        source: { url: URL.createObjectURL(file), name: file.name },
        feedId: previous.feedId + 1,
      }));
    },
    [detachVideo],
  );

  const clearVideoFile = useCallback(() => {
    detachVideo();
    setFeed((previous) => ({ source: null, feedId: previous.feedId + 1 }));
  }, [detachVideo]);

  const value = useMemo(
    () => ({ source, feedId, setVideoFile, clearVideoFile }),
    [source, feedId, setVideoFile, clearVideoFile],
  );

  return (
    <VideoSourceContext.Provider value={value}>
      {children}
    </VideoSourceContext.Provider>
  );
};
