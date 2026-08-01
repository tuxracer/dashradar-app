import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErrorScreen } from "@/components/ErrorScreen";

describe("ErrorScreen", () => {
  // The screen maps each code to its own headline, body, and glyph, so a code
  // added without a mapping entry renders a blank screen instead of failing
  // loudly. This is the guard for that.
  it("covers every error code with a headline, copy, and a glyph", () => {
    const codes = [
      "PERMISSION_DENIED",
      "NO_CAMERA",
      "CAMERA_IN_USE",
      "UNSUPPORTED",
      "MODEL_LOAD_FAILED",
      "INFERENCE_FAILED",
      "WORKER_CRASHED",
      "CAMERA_STALLED",
    ] as const;
    for (const code of codes) {
      const { container, unmount } = render(<ErrorScreen code={code} />);
      expect(screen.getByRole("heading").textContent).not.toBe("");
      expect(screen.getByTestId("error-message").textContent).not.toBe("");
      expect(container.querySelector("svg")).toBeInTheDocument();
      unmount();
    }
  });
});
