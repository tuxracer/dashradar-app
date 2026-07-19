import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { StatusBar } from "@/components/StatusBar";
import { SettingsProvider } from "@/context/SettingsContext";

const renderBar = (ui: ReactNode) =>
  render(<SettingsProvider>{ui}</SettingsProvider>);

describe("StatusBar", () => {
  it("shows GPU and fps when running on webgpu", () => {
    renderBar(<StatusBar backend="webgpu" fps={11} />);
    expect(screen.getByText("GPU · 11 FPS")).toBeInTheDocument();
  });

  it("shows CPU on the wasm fallback", () => {
    renderBar(<StatusBar backend="wasm" fps={4} />);
    expect(screen.getByText("CPU · 4 FPS")).toBeInTheDocument();
  });

  it("omits the readout until a backend is known", () => {
    renderBar(<StatusBar backend={undefined} fps={0} />);
    expect(screen.getByText("DASHRADAR")).toBeInTheDocument();
    expect(screen.queryByText(/FPS/)).not.toBeInTheDocument();
  });

  it("always renders the settings gear", () => {
    renderBar(<StatusBar backend={undefined} fps={0} />);
    expect(
      screen.getByRole("button", { name: /open settings/i }),
    ).toBeInTheDocument();
  });
});
