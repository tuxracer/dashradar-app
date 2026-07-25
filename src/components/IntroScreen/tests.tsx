import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DESKTOP_CONTINUE_CONFIRM_MESSAGE,
  INTRO_SEEN_STORAGE_KEY,
  INTRO_VERSION,
  IntroScreen,
  markIntroSeen,
  shouldShowIntro,
} from "@/components/IntroScreen";
import { SHARE_URL_LABEL } from "@/components/ShareCard";

/** Makes isDesktopDevice see a desktop (fine pointer) or mobile (coarse). */
const stubPointer = (desktop: boolean) => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: desktop })),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("shouldShowIntro", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("shows on a first open and never again after markIntroSeen", () => {
    expect(shouldShowIntro()).toBe(true);
    markIntroSeen();
    expect(shouldShowIntro()).toBe(false);
  });

  it("shows again for a stored version older than the current intro", () => {
    window.localStorage.setItem(INTRO_SEEN_STORAGE_KEY, "1");
    expect(shouldShowIntro()).toBe(true);
  });

  it("shows again for the pre-versioning flag value", () => {
    window.localStorage.setItem(INTRO_SEEN_STORAGE_KEY, "true");
    expect(shouldShowIntro()).toBe(true);
  });

  it("stays dismissed for a stored version newer than the current intro", () => {
    window.localStorage.setItem(
      INTRO_SEEN_STORAGE_KEY,
      String(INTRO_VERSION + 1),
    );
    expect(shouldShowIntro()).toBe(false);
  });
});

describe("IntroScreen", () => {
  it("calls onStart when the start button is tapped", () => {
    const onStart = vi.fn();
    const { getByRole } = render(<IntroScreen onStart={onStart} />);
    fireEvent.click(getByRole("button", { name: "START" }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("shows the start button and no QR code on mobile", () => {
    stubPointer(false);
    const { getByRole, queryByText } = render(
      <IntroScreen onStart={vi.fn()} />,
    );
    expect(getByRole("button", { name: "START" })).toBeInTheDocument();
    expect(queryByText(SHARE_URL_LABEL)).not.toBeInTheDocument();
  });

  it("replaces the start button with the QR code on desktop", () => {
    stubPointer(true);
    const { getByText, queryByRole } = render(
      <IntroScreen onStart={vi.fn()} />,
    );
    expect(getByText(SHARE_URL_LABEL)).toBeInTheDocument();
    expect(queryByRole("button", { name: "START" })).not.toBeInTheDocument();
  });

  it("calls onStart from the continue-on-this-device link once confirmed", () => {
    stubPointer(true);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onStart = vi.fn();
    const { getByRole } = render(<IntroScreen onStart={onStart} />);
    fireEvent.click(getByRole("button", { name: "Continue on this device" }));
    expect(confirm).toHaveBeenCalledWith(DESKTOP_CONTINUE_CONFIRM_MESSAGE);
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("keeps the intro up when the desktop confirm is cancelled", () => {
    stubPointer(true);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const onStart = vi.fn();
    const { getByRole } = render(<IntroScreen onStart={onStart} />);
    fireEvent.click(getByRole("button", { name: "Continue on this device" }));
    expect(onStart).not.toHaveBeenCalled();
  });
});
