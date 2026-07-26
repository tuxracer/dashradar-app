import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaveToast, SAVE_TOAST_DURATION_MS } from "@/components/SaveToast";
import type { SavedFrame } from "@/context/DetectionContext";

/** A save with a distinct `at`, the way the context publishes each one. */
const save = (filename: string, at: number): SavedFrame => ({ filename, at });

describe("SaveToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing until a frame has been saved", () => {
    render(<SaveToast saved={undefined} />);
    expect(screen.queryByTestId("save-toast")).not.toBeInTheDocument();
  });

  it("shows the saved filename when a save lands", () => {
    render(
      <SaveToast saved={save("dashradar-frame-2026-01-02-030405.jpg", 1)} />,
    );
    const toast = screen.getByTestId("save-toast");
    expect(toast).toHaveAttribute("data-visible", "true");
    expect(toast).toHaveTextContent("dashradar-frame-2026-01-02-030405.jpg");
  });

  it("hides itself after the toast duration", () => {
    render(<SaveToast saved={save("a.jpg", 1)} />);
    act(() => {
      vi.advanceTimersByTime(SAVE_TOAST_DURATION_MS);
    });
    expect(screen.getByTestId("save-toast")).toHaveAttribute(
      "data-visible",
      "false",
    );
  });

  // Auto save fires once per detection, so a run of saves has to keep
  // re-showing the toast; a toast that only appeared for the first file would
  // read as saving having stopped.
  it("shows again for the next save after hiding", () => {
    const { rerender } = render(<SaveToast saved={save("a.jpg", 1)} />);
    act(() => {
      vi.advanceTimersByTime(SAVE_TOAST_DURATION_MS);
    });
    rerender(<SaveToast saved={save("b.jpg", 2)} />);
    const toast = screen.getByTestId("save-toast");
    expect(toast).toHaveAttribute("data-visible", "true");
    expect(toast).toHaveTextContent("b.jpg");
  });
});
