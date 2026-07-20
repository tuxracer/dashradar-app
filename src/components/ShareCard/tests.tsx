import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShareCard, SHARE_URL } from "@/components/ShareCard";

// jsdom's navigator has no share(), so define one per test instead of
// replacing navigator wholesale (userEvent needs the real one intact).
const stubShare = (share: (data?: ShareData) => Promise<void>) => {
  Object.defineProperty(navigator, "share", {
    value: vi.fn(share),
    configurable: true,
  });
};

afterEach(() => {
  Reflect.deleteProperty(navigator, "share");
});

describe("ShareCard", () => {
  it("hides the share button when the Web Share API is unavailable", () => {
    render(<ShareCard />);
    expect(
      screen.queryByRole("button", { name: /share/i }),
    ).not.toBeInTheDocument();
  });

  it("shares the app URL through the Web Share API on tap", async () => {
    const user = userEvent.setup();
    stubShare(() => Promise.resolve());
    render(<ShareCard />);
    await user.click(screen.getByRole("button", { name: /share/i }));
    expect(navigator.share).toHaveBeenCalledWith({ url: SHARE_URL });
  });

  it("survives the user dismissing the share sheet", async () => {
    const user = userEvent.setup();
    stubShare(() =>
      Promise.reject(new DOMException("dismissed", "AbortError")),
    );
    render(<ShareCard />);
    await user.click(screen.getByRole("button", { name: /share/i }));
    expect(navigator.share).toHaveBeenCalledTimes(1);
  });
});
