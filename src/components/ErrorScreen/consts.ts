import type { CameraErrorCode } from "@/lib/camera";
import type { DetectionErrorCode } from "@/workers/detection/types";

export type AppErrorCode = CameraErrorCode | DetectionErrorCode;

export const ERROR_COPY: Readonly<Record<AppErrorCode, string>> = {
  PERMISSION_DENIED:
    "Camera access is blocked. Allow camera access for this site in your browser settings, then try again.",
  NO_CAMERA: "No camera was found on this device.",
  CAMERA_IN_USE:
    "The camera is in use by another app. Close it, then try again.",
  UNSUPPORTED:
    "This browser can't access the camera. Try a recent version of Chrome or Safari.",
  MODEL_LOAD_FAILED:
    "The detection model couldn't be downloaded. Check your connection, then try again.",
  INFERENCE_FAILED: "Detection stopped unexpectedly. Reload to restart it.",
  WORKER_CRASHED: "Detection stopped unexpectedly. Reload to restart it.",
};
