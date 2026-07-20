import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IntroScreen,
  markIntroSeen,
  shouldShowIntro,
} from "@/components/IntroScreen";

describe("shouldShowIntro", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("shows on a first open and never again after markIntroSeen", () => {
    expect(shouldShowIntro()).toBe(true);
    markIntroSeen();
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
});
