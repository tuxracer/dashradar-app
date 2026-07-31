import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { DEV_VIDEO_FALLBACK } from "./consts";
import type { DevVideoContextValue, DevVideoSource } from "./types";

export * from "./consts";
export * from "./types";

/** React context for the video source that substitutes for the camera. */
const DevVideoContext = createContext<DevVideoContextValue>(DEV_VIDEO_FALLBACK);

/** Hook to read the current feed source and swap it. */
export const useDevVideo = (): DevVideoContextValue =>
  useContext(DevVideoContext);

/**
 * Owns which video file, if any, stands in for the camera. Every session
 * starts on the camera; a dropped or picked file replaces it until cleared.
 * The choice cannot survive a reload: object URLs die with the page and a File
 * handle is not serializable.
 */
export const DevVideoProvider = ({ children }: { children: ReactNode }) => {
  const [source, setSource] = useState<DevVideoSource | null>(null);

  // Revoke the object URL of a source that has been replaced or cleared.
  // Cleanup runs after the next render commits, by which point the <video>
  // element using the old URL has unmounted. Revoking inline in the setter
  // would pull the source out from under an element still on screen.
  useEffect(() => {
    if (!source) {
      return;
    }
    return () => URL.revokeObjectURL(source.url);
  }, [source]);

  const setVideoFile = useCallback((file: File) => {
    setSource({ url: URL.createObjectURL(file), name: file.name });
  }, []);

  const clearVideoFile = useCallback(() => {
    setSource(null);
  }, []);

  const value = useMemo(
    () => ({ source, setVideoFile, clearVideoFile }),
    [source, setVideoFile, clearVideoFile],
  );

  return (
    <DevVideoContext.Provider value={value}>
      {children}
    </DevVideoContext.Provider>
  );
};
