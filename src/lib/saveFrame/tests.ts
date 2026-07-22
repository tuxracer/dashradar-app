import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadBlob, frameFilename, REVOKE_DELAY_MS } from "@/lib/saveFrame";

afterEach(() => {
  vi.restoreAllMocks();
  // Tests that opt into fake timers must restore real ones so later tests
  // (and vitest's own teardown) aren't left running on a fake clock.
  vi.useRealTimers();
  // jsdom has no createObjectURL/revokeObjectURL; tests assign them below.
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

describe("frameFilename", () => {
  it("formats the local date and time with the prefix and extension", () => {
    const date = new Date(2026, 6, 21, 14, 35, 2);
    expect(frameFilename(date)).toBe("dashradar-frame-2026-07-21-143502.jpg");
  });

  it("zero-pads single-digit date and time fields", () => {
    const date = new Date(2026, 0, 5, 4, 7, 9);
    expect(frameFilename(date)).toBe("dashradar-frame-2026-01-05-040709.jpg");
  });
});

describe("downloadBlob", () => {
  it("clicks a temporary anchor attached to the document, then revokes the object URL after a delay", () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:test-url");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clicks: Array<{
      href: string;
      download: string;
      isConnected: boolean;
    }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      // Captured at click time, not after: the anchor is removed from the
      // document immediately afterward, so reading isConnected later would
      // always report false regardless of whether the fix is in place.
      clicks.push({
        href: this.href,
        download: this.download,
        isConnected: this.isConnected,
      });
    });

    const blob = new Blob(["jpeg-bytes"], { type: "image/jpeg" });
    downloadBlob(blob, "test.jpg");

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicks).toEqual([
      { href: "blob:test-url", download: "test.jpg", isConnected: true },
    ]);
    // WebKit resolves blob-URL downloads asynchronously; revoking
    // synchronously can abort the download, so the revoke must be deferred.
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(REVOKE_DELAY_MS);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-url");
  });
});
