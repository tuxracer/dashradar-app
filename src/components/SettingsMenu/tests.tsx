import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsMenu } from "@/components/SettingsMenu";
import { SettingsProvider, STORAGE_KEY } from "@/context/SettingsContext";

afterEach(() => {
  window.localStorage.clear();
});

const renderMenu = () =>
  render(
    <SettingsProvider>
      <div data-testid="outside">outside</div>
      <SettingsMenu />
    </SettingsProvider>,
  );

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /open settings/i }));
};

describe("SettingsMenu", () => {
  it("hides the panel until the gear is clicked", async () => {
    const user = userEvent.setup();
    renderMenu();
    expect(screen.queryByText("Video feed")).not.toBeInTheDocument();
    await openMenu(user);
    expect(screen.getByText("Video feed")).toBeInTheDocument();
  });

  it("toggles the video setting and persists it", async () => {
    const user = userEvent.setup();
    renderMenu();
    await openMenu(user);
    await user.click(screen.getByText("Video feed"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({ showVideo: false }),
    );
  });

  it("closes the panel on Escape", async () => {
    const user = userEvent.setup();
    renderMenu();
    await openMenu(user);
    expect(screen.getByText("Video feed")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Video feed")).not.toBeInTheDocument();
  });

  it("closes the panel on an outside click", async () => {
    const user = userEvent.setup();
    renderMenu();
    await openMenu(user);
    expect(screen.getByText("Video feed")).toBeInTheDocument();
    await user.click(screen.getByTestId("outside"));
    expect(screen.queryByText("Video feed")).not.toBeInTheDocument();
  });
});
