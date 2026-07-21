/**
 * Media query that matches when the primary pointer is precise and can hover,
 * i.e. a mouse or trackpad. Phones and tablets report a coarse primary
 * pointer, while touchscreen laptops still report a fine one, which is
 * exactly the desktop/mobile split we want.
 */
const DESKTOP_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

/**
 * True when the app is running on a desktop or laptop rather than a phone or
 * tablet, judged by the primary pointer. Returns false (treat as mobile) when
 * matchMedia is unavailable, since the app is built for phones and the mobile
 * experience is the safe default.
 */
export const isDesktopDevice = (): boolean => {
  if (typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(DESKTOP_POINTER_QUERY).matches;
};
