/**
 * localStorage key set once the user has accepted the in-app camera
 * permission ask. While present, the custom permission screen is skipped and
 * the app goes straight to requesting the camera from the browser.
 */
export const CAMERA_PROMPT_STORAGE_KEY = "dashradar:cameraPromptAccepted";

/** A labeled reassurance row shown under the permission ask's body copy. */
export type PermissionPoint = {
  label: string;
  text: string;
};

/**
 * Privacy reassurance rows for the permission ask. Worded identically to the
 * PERMISSION_DENIED error screen's rows so the two screens speak with one
 * voice about the same promise.
 */
export const PERMISSION_POINTS: readonly PermissionPoint[] = [
  { label: "ON-DEVICE", text: "Detection runs entirely on your phone." },
  { label: "PRIVATE", text: "No images ever leave your device." },
];
