import { afterEach, describe, expect, it } from "vitest";
import { isDoNotTrackEnabled } from ".";

/**
 * Defines a possibly-non-standard property on a host global for the duration of
 * a test, returning a cleanup that removes it again.
 */
const withProperty = (
  target: object,
  key: string,
  value: unknown,
): (() => void) => {
  const had = Object.prototype.hasOwnProperty.call(target, key);
  const previous = Reflect.get(target, key);
  Object.defineProperty(target, key, { value, configurable: true });
  return () => {
    if (had) {
      Object.defineProperty(target, key, {
        value: previous,
        configurable: true,
      });
    } else {
      Reflect.deleteProperty(target, key);
    }
  };
};

describe("isDoNotTrackEnabled", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it("is false when no signal is set", () => {
    cleanups.push(withProperty(navigator, "doNotTrack", null));
    expect(isDoNotTrackEnabled()).toBe(false);
  });

  it('is true when navigator.doNotTrack is "1"', () => {
    cleanups.push(withProperty(navigator, "doNotTrack", "1"));
    expect(isDoNotTrackEnabled()).toBe(true);
  });

  it('is true when navigator.doNotTrack is "yes" (older browsers)', () => {
    cleanups.push(withProperty(navigator, "doNotTrack", "yes"));
    expect(isDoNotTrackEnabled()).toBe(true);
  });

  it('is false when navigator.doNotTrack is "0"', () => {
    cleanups.push(withProperty(navigator, "doNotTrack", "0"));
    expect(isDoNotTrackEnabled()).toBe(false);
  });

  it("is true when Global Privacy Control is set", () => {
    cleanups.push(withProperty(navigator, "doNotTrack", null));
    cleanups.push(withProperty(navigator, "globalPrivacyControl", true));
    expect(isDoNotTrackEnabled()).toBe(true);
  });

  it("is true when the legacy window.doNotTrack is set", () => {
    cleanups.push(withProperty(navigator, "doNotTrack", null));
    cleanups.push(withProperty(window, "doNotTrack", "1"));
    expect(isDoNotTrackEnabled()).toBe(true);
  });
});
