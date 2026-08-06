import { afterEach, describe, expect, it, vi } from "vitest";
import { INSTALL_ID_STORAGE_KEY, readInstallId } from "@/lib/installId";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("readInstallId", () => {
  it("keeps the same id across reads, which is what makes it a device count", () => {
    const first = readInstallId();
    expect(first).toEqual(expect.any(String));
    expect(readInstallId()).toBe(first);
    expect(readInstallId()).toBe(first);
  });

  it("stores the minted id so the next page load reports the same device", () => {
    const minted = readInstallId();
    expect(window.localStorage.getItem(INSTALL_ID_STORAGE_KEY)).toBe(minted);
  });

  it("returns an id already in storage rather than minting over it", () => {
    window.localStorage.setItem(INSTALL_ID_STORAGE_KEY, "stored-id");
    const randomUUID = vi.spyOn(window.crypto, "randomUUID");
    expect(readInstallId()).toBe("stored-id");
    expect(randomUUID).not.toHaveBeenCalled();
  });

  // Spied on the prototype, not the instance: jsdom's localStorage is a Proxy,
  // so an own property assigned onto it is never the one the getter reaches.
  it("returns undefined rather than an unstorable id when writing fails", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(readInstallId()).toBeUndefined();
  });

  it("returns undefined when storage cannot be read at all", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readInstallId()).toBeUndefined();
  });

  it("returns undefined when the platform has no randomUUID", () => {
    vi.spyOn(window.crypto, "randomUUID").mockImplementation(() => {
      throw new TypeError("randomUUID is not a function");
    });
    expect(readInstallId()).toBeUndefined();
  });
});
