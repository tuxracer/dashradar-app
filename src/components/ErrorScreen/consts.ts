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

export const ERROR_COPY: Readonly<Record<AppErrorCode, string>> = {
  PERMISSION_DENIED:
    "This app spots patrol vehicles by watching the road through your camera, so it can't run without it. Detection runs entirely on your phone and no images ever leave your device. Allow camera access for this site, then try again.",
  NO_CAMERA: "No camera was found on this device.",
  CAMERA_IN_USE:
    "The camera is in use by another app. Close it, then try again.",
  UNSUPPORTED:
    "This browser can't access the camera. Try a recent version of Chrome or Safari.",
  MODEL_LOAD_FAILED:
    "The detection model couldn't be downloaded. Check your connection, then try again.",
  INFERENCE_FAILED: "Detection stopped unexpectedly. Reload to restart it.",
  WORKER_CRASHED: "Detection stopped unexpectedly. Reload to restart it.",
  CAMERA_STALLED: "Camera view lost. Make sure nothing is blocking the camera.",
};
