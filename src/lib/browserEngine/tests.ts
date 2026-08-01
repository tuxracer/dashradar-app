import { describe, expect, it } from "vitest";
import { isWebKitUa } from "./index";

/** Real-world user-agent strings for each engine family. */
const WEBKIT_UAS: Record<string, string> = {
  "iOS Safari":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1",
  "iOS Chrome (WebKit shell)":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
  "iOS Firefox (WebKit shell)":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15",
  "macOS Safari":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
};

const NON_WEBKIT_UAS: Record<string, string> = {
  "macOS Chrome":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Android Chrome":
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36",
  "Windows Edge":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.68",
  "Samsung Internet":
    "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  "Desktop Firefox (Gecko)":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0",
};

describe("isWebKitUa", () => {
  it.each(Object.entries(WEBKIT_UAS))(
    "recognizes %s as WebKit",
    (_name, ua) => {
      expect(isWebKitUa(ua)).toBe(true);
    },
  );

  it.each(Object.entries(NON_WEBKIT_UAS))(
    "recognizes %s as not WebKit",
    (_name, ua) => {
      expect(isWebKitUa(ua)).toBe(false);
    },
  );

  it("treats an empty user agent as not WebKit", () => {
    expect(isWebKitUa("")).toBe(false);
  });
});
