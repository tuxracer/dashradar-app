/** A video file standing in for the camera as the detection feed. */
export type VideoSource = {
  /** Object URL of the chosen file, which the player plays. */
  url: string;
  /** Shown in the settings row so it is obvious which clip is playing. */
  name: string;
};

/** What VideoSourceProvider hands its consumers. */
export type VideoSourceContextValue = {
  /** The file the detector is scanning, or null while the camera is the feed. */
  source: VideoSource | null;
  /**
   * Identity of the current selection, minted fresh on every swap. The two
   * camera sessions either side of a clip are different feeds even though both
   * are "the camera", and consumers holding state about the feed (its video
   * element, its failure) compare against this to tell whether what they are
   * holding still belongs to the feed on screen.
   */
  feedId: number;
  /** Replaces the feed with `file`, minting an object URL for it. */
  setVideoFile: (file: File) => void;
  /** Returns the feed to the camera, releasing the current clip. */
  clearVideoFile: () => void;
};
