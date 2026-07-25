import type { ZoomMode } from "@/context/SettingsContext";

/** Hugging Face model repo slug shown in the Model row. */
export const MODEL_SLUG = "las-vegas-metro-rfdetr-small-t1";

/** Hugging Face model page opened from the Model row. */
export const MODEL_URL =
  "https://huggingface.co/tuxracer/las-vegas-metro-rfdetr-small-t1";

/** GitHub repository opened from the About row. */
export const REPO_URL = "https://github.com/tuxracer/dashradar-app";

/**
 * Segments of the Zoom row's mode picker, in display order. Labels are the
 * on-glass text; each maps to the ZoomMode it selects.
 */
export const ZOOM_MODE_OPTIONS: readonly {
  mode: ZoomMode;
  label: string;
}[] = [
  { mode: "1x", label: "1X" },
  { mode: "2x", label: "2X" },
  { mode: "auto", label: "AUTO" },
];
