import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SHARE_URL, SHARE_URL_LABEL } from "@/components/ShareCard";
import { UnsupportedScreen } from "@/components/UnsupportedScreen";

/**
 * jsdom's navigator has no share(); define one per test rather than replacing
 * navigator wholesale, which userEvent needs left intact.
 */
const stubShare = () => {
  const share = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "share", {
    value: share,
    configurable: true,
  });
  return share;
};

afterEach(() => {
  Reflect.deleteProperty(navigator, "share");
  vi.restoreAllMocks();
});

describe("UnsupportedScreen", () => {
  it("leads with what to do rather than what failed", () => {
    render(<UnsupportedScreen />);
    expect(screen.getByRole("heading").textContent).toMatch(
      /open it on another phone/i,
    );
  });

  it("says plainly that this device is the problem", () => {
    render(<UnsupportedScreen />);
    expect(screen.getByTestId("unsupported-message").textContent).toMatch(
      /this device.s graphics chip can.t run the detection/i,
    );
  });

  it("never blames the age of the reader's phone", () => {
    render(<UnsupportedScreen />);
    const copy = document.body.textContent ?? "";
    // The requirement is GPU feature support, not recency: a current budget
    // phone can fail where an older flagship passes. Copy that asks for a
    // "newer" or "recent" phone is both insulting and factually wrong.
    expect(copy).not.toMatch(/newer|recent|older|outdated|unsupported device/i);
  });

  it("explains the requirement without naming the machinery", () => {
    render(<UnsupportedScreen />);
    const copy = document.body.textContent ?? "";
    // "browser", "GPU", and "WebGPU" describe how the app is built, not what
    // the reader can do; a driver reading this screen needs neither.
    expect(copy).not.toMatch(/browser|GPU|WebGPU|acceleration/i);
    expect(copy).toMatch(/graphics chip/i);
  });

  it("labels the QR with what scanning it does", () => {
    render(<UnsupportedScreen />);
    expect(screen.getByText(/scan to open/i)).toBeInTheDocument();
  });

  it("offers no retry, which a reload could not clear anyway", () => {
    render(<UnsupportedScreen />);
    expect(
      screen.queryByRole("button", { name: /try again/i }),
    ).not.toBeInTheDocument();
  });

  it("always offers the QR handoff", () => {
    render(<UnsupportedScreen />);
    expect(screen.getByText(SHARE_URL_LABEL)).toBeInTheDocument();
  });

  it("keeps the QR alongside the share sheet where it exists", () => {
    stubShare();
    render(<UnsupportedScreen />);
    // Complements, not alternatives: the QR hands off to a second screen
    // someone is holding, the share sheet to a second device of your own.
    expect(screen.getByText(SHARE_URL_LABEL)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send link/i }),
    ).toBeInTheDocument();
  });

  it("sends the app URL through the share sheet", async () => {
    const user = userEvent.setup();
    const share = stubShare();
    render(<UnsupportedScreen />);
    await user.click(screen.getByRole("button", { name: /send link/i }));
    expect(share).toHaveBeenCalledWith({ url: SHARE_URL });
  });

  it("leaves the QR standing alone where the Web Share API is absent", () => {
    render(<UnsupportedScreen />);
    expect(screen.getByText(SHARE_URL_LABEL)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
