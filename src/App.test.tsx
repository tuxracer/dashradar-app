import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "@/App";

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("App", () => {
  it("shows the intro on first open, then the camera error screen when the camera is unavailable", async () => {
    vi.stubGlobal(
      "Worker",
      class {
        onmessage = null;
        onerror = null;
        postMessage() {}
        terminate() {}
      },
    );
    vi.stubGlobal("navigator", {});
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "START" }));
    await waitFor(() =>
      expect(
        screen.getByText(/browser can't access the camera/i),
      ).toBeInTheDocument(),
    );
  });
});
