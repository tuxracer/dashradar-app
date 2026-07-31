/**
 * localStorage key set once the user has accepted the in-app camera
 * permission ask. While present, the custom permission screen is skipped and
 * the app goes straight to requesting the camera from the browser.
 */
export const CAMERA_PROMPT_STORAGE_KEY = "cameraPromptAccepted";

/** A labeled reassurance row shown under the permission ask's body copy. */
export type PermissionPoint = {
  label: string;
  text: string;
};

/**
 * Privacy reassurance for the permission ask, kept to a single row so the ask
 * stays glanceable. The PERMISSION_DENIED error screen carries the fuller
 * two-row version for users who declined and need more convincing.
 */
export const PERMISSION_POINTS: readonly PermissionPoint[] = [
  {
    label: "PRIVATE",
    text: "Detection runs on your phone. No images ever leave it.",
  },
];
