import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErrorScreen } from "@/components/ErrorScreen";

describe("ErrorScreen", () => {
  it("explains a denied camera permission", () => {
    render(<ErrorScreen code="PERMISSION_DENIED" />);
    expect(
      screen.getByRole("heading", { name: /camera access needed/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/spots patrol vehicles by watching the road/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
  });

  it("reassures on privacy when permission is denied", () => {
    render(<ErrorScreen code="PERMISSION_DENIED" />);
    expect(screen.getByText("ON-DEVICE")).toBeInTheDocument();
    expect(
      screen.getByText(/no images ever leave your device/i),
    ).toBeInTheDocument();
  });

  it("explains a failed model download", () => {
    render(<ErrorScreen code="MODEL_LOAD_FAILED" />);
    expect(
      screen.getByText(/detection model couldn't be downloaded/i),
    ).toBeInTheDocument();
  });

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

  it("asks the driver to clear the lens on a stalled camera", () => {
    render(<ErrorScreen code="CAMERA_STALLED" />);
    expect(
      screen.getByText(/make sure nothing is blocking the camera/i),
    ).toBeInTheDocument();
  });
});
