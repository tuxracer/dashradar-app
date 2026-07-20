/** Hugging Face model repo slug shown in the Model row. */
export const MODEL_SLUG = "las-vegas-metro-rfdetr-small-t1";

/** Hugging Face model page opened from the Model row. */
export const MODEL_URL =
  "https://huggingface.co/tuxracer/las-vegas-metro-rfdetr-small-t1";

/** GitHub repository opened from the About row. */
export const REPO_URL = "https://github.com/tuxracer/dashradar-app";

/**
 * How often the open panel refreshes the fps readout. fps lives in a ref
 * (`getFps`), not React state, so detection results don't re-render the app;
 * the panel polls it at a leisurely rate instead.
 */
export const FPS_POLL_MS = 1_000;
