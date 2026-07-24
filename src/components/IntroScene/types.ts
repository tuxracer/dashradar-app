/**
 * Handle to a live intro-scene WebGL renderer. Returned by
 * createIntroSceneRenderer, or null when WebGL2 is unavailable or shader
 * setup fails, in which case the RadarBackdrop grid stays visible instead.
 */
export type IntroSceneRenderer = {
  /** Draws one frame at the given scene time in seconds. */
  render: (timeS: number) => void;
  /** Matches the drawing buffer to the container's layout size. */
  resize: () => void;
  /** Removes the canvas and releases the WebGL context. */
  dispose: () => void;
};
