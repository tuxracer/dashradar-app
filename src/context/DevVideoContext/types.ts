/** A video file standing in for the camera feed. */
export type DevVideoSource = {
  /** Object URL of the chosen file. */
  url: string;
  /** Shown in the settings row so it is obvious which clip is playing. */
  name: string;
};

/** What DevVideoProvider hands its consumers. */
export type DevVideoContextValue = {
  /** The feed detection runs against, or null to use the camera. */
  source: DevVideoSource | null;
  /** Replaces the feed with `file`, minting an object URL for it. */
  setVideoFile: (file: File) => void;
  /** Returns the feed to the camera, releasing the current clip. */
  clearVideoFile: () => void;
};
