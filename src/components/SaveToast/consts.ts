/**
 * How long the toast stays up after a save. Auto save fires at most once per
 * scan, so this sits just under the MIN_FRAME_INTERVAL_MS pacing floor: a run
 * of saved detections gives a short gap between toasts, which reads as one
 * toast per file rather than a banner that never moves.
 */
export const SAVE_TOAST_DURATION_MS = 1_500;
