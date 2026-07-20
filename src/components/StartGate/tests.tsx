import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { shouldShowStartGate, StartGate } from "@/components/StartGate";

describe("shouldShowStartGate", () => {
  it("shows only while permission is still 'prompt'", () => {
    expect(shouldShowStartGate("prompt")).toBe(true);
    expect(shouldShowStartGate("granted")).toBe(false);
    expect(shouldShowStartGate("denied")).toBe(false);
    expect(shouldShowStartGate("unsupported")).toBe(false);
  });
});

describe("StartGate", () => {
  it("calls onStart when tapped", () => {
    const onStart = vi.fn();
    const { getByRole } = render(<StartGate onStart={onStart} />);
    fireEvent.click(getByRole("button"));
    expect(onStart).toHaveBeenCalledOnce();
  });
});
