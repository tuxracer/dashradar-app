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
 * Owns which video file, if any, the detector scans instead of the camera. The
 * choice cannot survive a reload: object URLs die with the page.
 *
 * Sits inside DetectionProvider because every swap detaches the engine's video
 * first: the element the pump captures from is about to unmount, and detaching
 * also drops the tracker's history, which has nothing to do with the new feed.
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
      // Minted before setFeed because updaters must stay pure: React can run
      // an updater more than once (StrictMode does, concurrent rerenders may),
      // and a URL minted in a discarded invocation never reaches state, so the
      // revoke effect above could never release it.
      const url = URL.createObjectURL(file);
      setFeed((previous) => ({
        source: { url, name: file.name },
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
