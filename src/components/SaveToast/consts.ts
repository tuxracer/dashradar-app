/**
 * How long the toast stays up after a save. Long enough to read the filename
 * at a glance; a run of back-to-back saves (auto save fires at most once per
 * scan, MIN_FRAME_INTERVAL_MS apart) restarts the toast per file instead of
 * queueing.
 */
export const SAVE_TOAST_DURATION_MS = 1_500;
