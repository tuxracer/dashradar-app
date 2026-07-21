import { isString } from "remeda";

/**
 * Reads a possibly-absent property off a host object (navigator/window) as
 * `unknown`, so the non-standard privacy signals below can be checked without
 * a type assertion or a global type augmentation.
 */
const readProperty = (source: object, key: string): unknown =>
  Reflect.get(source, key);

/**
 * True when a value represents an opted-out privacy signal. Global Privacy
 * Control reports a boolean `true`; Do Not Track reports a string, "1" in
 * modern browsers and "yes" in some older ones.
 */
const isOptedOutSignal = (value: unknown): boolean =>
  value === true || (isString(value) && (value === "1" || value === "yes"));

/**
 * True when the browser signals that the user does not want to be tracked, via
 * either the legacy Do Not Track setting or the newer Global Privacy Control
 * signal. Checks every place browsers have exposed these: navigator.doNotTrack,
 * window.doNotTrack, the old navigator.msDoNotTrack, and
 * navigator.globalPrivacyControl. Returns false when nothing is set or when
 * there is no navigator (tests), so analytics stays on only when the user has
 * not opted out.
 */
export const isDoNotTrackEnabled = (): boolean => {
  if (typeof navigator === "undefined") {
    return false;
  }
  const candidates = [
    readProperty(navigator, "doNotTrack"),
    readProperty(navigator, "msDoNotTrack"),
    readProperty(navigator, "globalPrivacyControl"),
    typeof window === "undefined"
      ? undefined
      : readProperty(window, "doNotTrack"),
  ];
  return candidates.some(isOptedOutSignal);
};
