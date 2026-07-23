import type { CameraErrorCode } from "@/lib/camera";
import type { DetectionErrorCode } from "@/workers/detection/types";

/**
 * Error codes the app raises itself, neither a getUserMedia CameraErrorCode nor
 * a worker DetectionErrorCode. CAMERA_STALLED is surfaced when automatic camera
 * recovery has exhausted its remount attempts on a frozen or black feed, so the
 * driver is asked to clear the lens and reload rather than the page silently
 * reloading in a loop.
 */
export type AppLevelErrorCode = "CAMERA_STALLED";

export type AppErrorCode =
  | CameraErrorCode
  | DetectionErrorCode
  | AppLevelErrorCode;

/** A labeled reassurance row shown under an error's body copy. */
export type ErrorPoint = {
  label: string;
  text: string;
};

/** Structured copy for one error code: headline, body, optional point rows. */
export type ErrorCopy = {
  title: string;
  body: string;
  points?: readonly ErrorPoint[];
};

export const ERROR_COPY: Readonly<Record<AppErrorCode, ErrorCopy>> = {
  PERMISSION_DENIED: {
    title: "CAMERA ACCESS NEEDED",
    body: "This app spots patrol vehicles by watching the road through your camera, so it can't run without it. Allow camera access for this site, then try again.",
    points: [
      { label: "ON-DEVICE", text: "Detection runs entirely on your phone." },
      { label: "PRIVATE", text: "No images ever leave your device." },
    ],
  },
  NO_CAMERA: {
    title: "NO CAMERA FOUND",
    body: "No camera was found on this device.",
  },
  CAMERA_IN_USE: {
    title: "CAMERA IN USE",
    body: "The camera is in use by another app. Close it, then try again.",
  },
  UNSUPPORTED: {
    title: "BROWSER NOT SUPPORTED",
    body: "This browser can't access the camera. Try a recent version of Chrome or Safari.",
  },
  MODEL_LOAD_FAILED: {
    title: "DOWNLOAD FAILED",
    body: "The detection model couldn't be downloaded. Check your connection, then try again.",
  },
  INFERENCE_FAILED: {
    title: "DETECTION STOPPED",
    body: "Detection stopped unexpectedly. Reload to restart it.",
  },
  WORKER_CRASHED: {
    title: "DETECTION STOPPED",
    body: "Detection stopped unexpectedly. Reload to restart it.",
  },
  CAMERA_STALLED: {
    title: "CAMERA VIEW LOST",
    body: "Make sure nothing is blocking the camera, then try again.",
  },
};
