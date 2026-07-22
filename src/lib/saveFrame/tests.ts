import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadBlob, frameFilename } from "@/lib/saveFrame";

afterEach(() => {
  vi.restoreAllMocks();
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
  it("clicks a temporary anchor at an object URL of the blob, then revokes it", () => {
    const createObjectURL = vi.fn(() => "blob:test-url");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clicks: Array<{ href: string; download: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push({ href: this.href, download: this.download });
    });

    const blob = new Blob(["jpeg-bytes"], { type: "image/jpeg" });
    downloadBlob(blob, "test.jpg");

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicks).toEqual([{ href: "blob:test-url", download: "test.jpg" }]);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-url");
  });
});
