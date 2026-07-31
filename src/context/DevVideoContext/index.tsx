import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { DEV_VIDEO_FALLBACK, ENV_VIDEO_SOURCE } from "./consts";
import type { DevVideoContextValue, DevVideoSource } from "./types";

export * from "./consts";
export * from "./types";

/** React context for the video source that substitutes for the camera. */
const DevVideoContext = createContext<DevVideoContextValue>(DEV_VIDEO_FALLBACK);

/** Hook to read the current feed source and swap it. */
export const useDevVideo = (): DevVideoContextValue =>
  useContext(DevVideoContext);

/**
 * Owns which video file, if any, stands in for the camera. The source is the
 * startup feed (DASHRADAR_VIDEO, or the camera) unless a dropped or picked
 * file overrides it, so clearing an override always restores what the session
 * started with. An override cannot survive a reload: object URLs die with the
 * page and a File handle is not serializable.
 */
export const DevVideoProvider = ({ children }: { children: ReactNode }) => {
  const [override, setOverride] = useState<DevVideoSource | null>(null);

  // Revoke the object URL of an override that has been replaced or cleared.
  // Cleanup runs after the next render commits, by which point the <video>
  // element using the old URL has unmounted. Revoking inline in the setter
  // would pull the source out from under an element still on screen.
  useEffect(() => {
    if (!override) {
      return;
    }
    return () => URL.revokeObjectURL(override.url);
  }, [override]);

  const setVideoFile = useCallback((file: File) => {
    setOverride({ url: URL.createObjectURL(file), name: file.name });
  }, []);

  const clearVideoFile = useCallback(() => {
    setOverride(null);
  }, []);

  const value = useMemo(
    () => ({
      source: override ?? ENV_VIDEO_SOURCE,
      overridden: override !== null,
      setVideoFile,
      clearVideoFile,
    }),
    [override, setVideoFile, clearVideoFile],
  );

  return (
    <DevVideoContext.Provider value={value}>
      {children}
    </DevVideoContext.Provider>
  );
};
