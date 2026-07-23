import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecoveryOverlay } from "@/components/RecoveryOverlay";

describe("RecoveryOverlay", () => {
  it("shows the reconnecting message when visible", () => {
    render(<RecoveryOverlay visible />);
    expect(screen.getByText(/reconnecting camera/i)).toBeInTheDocument();
  });

  it("renders nothing when not visible", () => {
    const { container } = render(<RecoveryOverlay visible={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
