import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "@/App";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("shows the camera error screen when the camera is unavailable", async () => {
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
    await waitFor(() =>
      expect(
        screen.getByText(/browser can't access the camera/i),
      ).toBeInTheDocument(),
    );
  });
});
