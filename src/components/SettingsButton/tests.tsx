import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SettingsButton } from "@/components/SettingsButton";
import { SettingsProvider, useSettings } from "@/context/SettingsContext";

const OpenState = () => {
  const { settingsOpen } = useSettings();
  return <div data-testid="open">{settingsOpen ? "open" : "closed"}</div>;
};

describe("SettingsButton", () => {
  it("opens the settings panel when the gear is clicked", async () => {
    const user = userEvent.setup();
    render(
      <SettingsProvider>
        <OpenState />
        <SettingsButton />
      </SettingsProvider>,
    );
    expect(screen.getByTestId("open")).toHaveTextContent("closed");
    await user.click(screen.getByRole("button", { name: /open settings/i }));
    expect(screen.getByTestId("open")).toHaveTextContent("open");
  });
});
