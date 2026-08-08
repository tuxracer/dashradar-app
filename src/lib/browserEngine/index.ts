/**
 * Whether a user-agent string belongs to a WebKit-engine browser. Every
 * browser on iOS outside the EU's alternative-engine carve-out is WebKit
 * regardless of its brand (Safari, CriOS, FxiOS), so this is the right test
 * for "running on Apple's engine", not a Safari brand check. The AppleWebKit
 * token alone is useless for this: Blink-based browsers (Chrome, Edge,
 * Samsung Internet) still carry it as a legacy compatibility token, but they
 * also always carry a Chrome/, Chromium/, or Edg/ product token that real
 * WebKit browsers never do, so excluding those identifies actual WebKit.
 */
export const isWebKitUa = (userAgent: string): boolean =>
  userAgent.includes("AppleWebKit") &&
  !/Chrome\/|Chromium\/|Edg\//.test(userAgent);
