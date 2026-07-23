import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelLoadScreen } from "@/components/ModelLoadScreen";
import { LOADING_INDICATOR_DELAY_MS } from "@/components/ModelLoadScreen";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ModelLoadScreen", () => {
  it("stays hidden during the anti-flash delay", () => {
    render(<ModelLoadScreen progress={{ loadedBytes: 0, totalBytes: 0 }} />);
    expect(screen.queryByText(/DOWNLOADING/)).not.toBeInTheDocument();
  });

  it("shows progress in MB and percent after the delay", () => {
    render(
      <ModelLoadScreen
        progress={{ loadedBytes: 15_000_000, totalBytes: 30_000_000 }}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(LOADING_INDICATOR_DELAY_MS);
    });
    expect(screen.getByText(/DOWNLOADING MODEL/)).toBeInTheDocument();
    expect(screen.getByText(/15\.0 MB \/ 30\.0 MB/)).toBeInTheDocument();
    expect(screen.getByText(/50%/)).toBeInTheDocument();
  });

  it("switches to PREPARING once the download completes", () => {
    render(
      <ModelLoadScreen
        progress={{ loadedBytes: 30_000_000, totalBytes: 30_000_000 }}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(LOADING_INDICATOR_DELAY_MS);
    });
    expect(screen.getByText(/PREPARING MODEL/)).toBeInTheDocument();
    expect(screen.queryByText(/DOWNLOADING/)).not.toBeInTheDocument();
    expect(screen.getByText(/100%/)).toBeInTheDocument();
  });

  it("stays in the downloading phase while the total is still unknown", () => {
    render(<ModelLoadScreen progress={{ loadedBytes: 0, totalBytes: 0 }} />);
    act(() => {
      vi.advanceTimersByTime(LOADING_INDICATOR_DELAY_MS);
    });
    expect(screen.getByText(/DOWNLOADING MODEL/)).toBeInTheDocument();
  });
});
