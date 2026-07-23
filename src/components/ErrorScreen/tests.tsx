import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErrorScreen } from "@/components/ErrorScreen";

describe("ErrorScreen", () => {
  it("explains a denied camera permission", () => {
    render(<ErrorScreen code="PERMISSION_DENIED" />);
    expect(
      screen.getByText(/spots patrol vehicles by watching the road/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
  });

  it("explains a failed model download", () => {
    render(<ErrorScreen code="MODEL_LOAD_FAILED" />);
    expect(
      screen.getByText(/detection model couldn't be downloaded/i),
    ).toBeInTheDocument();
  });

  it("covers every error code with copy", () => {
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
      const { unmount } = render(<ErrorScreen code={code} />);
      expect(screen.getByTestId("error-message").textContent).not.toBe("");
      unmount();
    }
  });

  it("asks the driver to clear the lens on a stalled camera", () => {
    render(<ErrorScreen code="CAMERA_STALLED" />);
    expect(
      screen.getByText(/make sure nothing is blocking the camera/i),
    ).toBeInTheDocument();
  });

  it("renders a supplied icon above the copy", () => {
    render(
      <ErrorScreen code="CAMERA_STALLED" icon={<svg data-testid="icon" />} />,
    );
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });
});
