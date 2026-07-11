import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBar } from "@/components/StatusBar";

describe("StatusBar", () => {
  it("shows GPU and fps when running on webgpu", () => {
    render(<StatusBar backend="webgpu" fps={11} />);
    expect(screen.getByText("GPU · 11 FPS")).toBeInTheDocument();
  });

  it("shows CPU on the wasm fallback", () => {
    render(<StatusBar backend="wasm" fps={4} />);
    expect(screen.getByText("CPU · 4 FPS")).toBeInTheDocument();
  });

  it("omits the readout until a backend is known", () => {
    render(<StatusBar backend={undefined} fps={0} />);
    expect(screen.getByText("DASHRADAR")).toBeInTheDocument();
    expect(screen.queryByText(/FPS/)).not.toBeInTheDocument();
  });
});
