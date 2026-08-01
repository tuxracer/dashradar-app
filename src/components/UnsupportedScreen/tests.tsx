import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SHARE_URL_LABEL } from "@/components/ShareCard";
import { UnsupportedScreen } from "@/components/UnsupportedScreen";

/**
 * jsdom's navigator has no share(); define one per test rather than replacing
 * navigator wholesale, which userEvent needs left intact.
 */
const stubShare = () => {
  Object.defineProperty(navigator, "share", {
    value: vi.fn(() => Promise.resolve()),
    configurable: true,
  });
};

afterEach(() => {
  Reflect.deleteProperty(navigator, "share");
});

describe("UnsupportedScreen", () => {
  // Complements, not alternatives: the QR hands off to a second screen someone
  // is holding, the share sheet to a second device of your own. Gating either
  // on the other's absence removes a route that was doing its own job.
  it("keeps the QR alongside the share sheet where it exists", () => {
    stubShare();
    render(<UnsupportedScreen />);
    expect(screen.getByText(SHARE_URL_LABEL)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send link/i }),
    ).toBeInTheDocument();
  });

  it("leaves the QR standing alone where the Web Share API is absent", () => {
    render(<UnsupportedScreen />);
    expect(screen.getByText(SHARE_URL_LABEL)).toBeInTheDocument();
  });
});
