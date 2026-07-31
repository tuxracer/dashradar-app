/** A video file standing in for the camera feed. */
export type DevVideoSource = {
  /** Object URL of a chosen file, or the dev-server route for DASHRADAR_VIDEO. */
  url: string;
  /** Shown in the settings row so it is obvious which clip is playing. */
  name: string;
};

/** What DevVideoProvider hands its consumers. */
export type DevVideoContextValue = {
  /** The feed detection runs against, or null to use the camera. */
  source: DevVideoSource | null;
  /** True when a chosen file is overriding the startup source. */
  overridden: boolean;
  /** Replaces the feed with `file`, minting an object URL for it. */
  setVideoFile: (file: File) => void;
  /** Drops the override, falling back to the startup source. */
  clearVideoFile: () => void;
};
