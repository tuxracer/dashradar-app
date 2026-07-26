import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBar } from "@/components/StatusBar";
import { SettingsProvider } from "@/context/SettingsContext";
import { WORDMARK } from "@/lib/branding";

const renderBar = () =>
  render(
    <SettingsProvider>
      <StatusBar />
    </SettingsProvider>,
  );

describe("StatusBar", () => {
  it("renders the wordmark", () => {
    renderBar();
    expect(screen.getByText(WORDMARK)).toBeInTheDocument();
  });

  it("no longer shows an FPS readout", () => {
    renderBar();
    expect(screen.queryByText(/FPS/)).not.toBeInTheDocument();
  });

  it("renders the settings gear", () => {
    renderBar();
    expect(
      screen.getByRole("button", { name: /open settings/i }),
    ).toBeInTheDocument();
  });

  it("renders a center slot alongside the wordmark and gear", () => {
    // The gear sits in the grid's third column, so it has to survive a
    // populated middle column rather than being pushed out of place by it.
    render(
      <SettingsProvider>
        <StatusBar center={<span>AUTO · 1X</span>} />
      </SettingsProvider>,
    );
    expect(screen.getByText("AUTO · 1X")).toBeInTheDocument();
    expect(screen.getByText(WORDMARK)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /open settings/i }),
    ).toBeInTheDocument();
  });
});
