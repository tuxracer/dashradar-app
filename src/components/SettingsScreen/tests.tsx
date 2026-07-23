import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsButton } from "@/components/SettingsButton";
import { SettingsScreen } from "@/components/SettingsScreen";
import { SettingsProvider, STORAGE_KEY } from "@/context/SettingsContext";
import type { DetectionBackend } from "@/workers/detection/types";
import { MODEL_REVISION } from "@/workers/detection/consts";

afterEach(() => {
  window.localStorage.clear();
});

const renderScreen = (props: { backend?: DetectionBackend } = {}) =>
  render(
    <SettingsProvider>
      <SettingsButton />
      <SettingsScreen backend={props.backend} />
    </SettingsProvider>,
  );

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /open settings/i }));
};

describe("SettingsScreen", () => {
  it("renders nothing until the panel is opened", async () => {
    const user = userEvent.setup();
    renderScreen();
    expect(screen.queryByText("Audio alerts")).not.toBeInTheDocument();
    await open(user);
    expect(screen.getByText("Audio alerts")).toBeInTheDocument();
  });

  it("toggles and persists the audio setting from the Audio alerts row", async () => {
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    await user.click(screen.getByText("Audio alerts"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        showDebug: false,
        radarAudio: false,
        throttleInference: true,
      }),
    );
  });

  it("toggles and persists the debug setting from the Debug overlay row", async () => {
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    await user.click(screen.getByText("Debug overlay"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        showDebug: true,
        radarAudio: true,
        throttleInference: true,
      }),
    );
  });

  it("closes on the close button", async () => {
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    await user.click(screen.getByRole("button", { name: /close settings/i }));
    expect(screen.queryByText("Audio alerts")).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Audio alerts")).not.toBeInTheDocument();
  });

  it("shows the GPU engine readout without an fps figure", async () => {
    const user = userEvent.setup();
    renderScreen({ backend: "webgpu" });
    await open(user);
    expect(screen.getByText("GPU")).toBeInTheDocument();
    expect(screen.queryByText(/FPS/)).not.toBeInTheDocument();
  });

  it("shows the CPU engine readout on the wasm fallback", async () => {
    const user = userEvent.setup();
    renderScreen({ backend: "wasm" });
    await open(user);
    expect(screen.getByText("CPU")).toBeInTheDocument();
  });

  it("shows a starting placeholder before a backend is known", async () => {
    const user = userEvent.setup();
    renderScreen({ backend: undefined });
    await open(user);
    expect(screen.getByText(/starting/i)).toBeInTheDocument();
  });

  it("shows the model slug with its revision", async () => {
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    const modelRow = screen.getByText(/las-vegas-metro-rfdetr-small-t1/);
    expect(modelRow).toBeInTheDocument();
    expect(modelRow).toHaveTextContent(MODEL_REVISION);
  });

  it("shows the commit sha as the build label", async () => {
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    expect(
      screen.getByText(new RegExp(`^${__COMMIT_SHA__} ↗$`)),
    ).toBeInTheDocument();
  });

  it("hides the throttle row while debug mode is off", async () => {
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    expect(screen.queryByText("Throttle inference")).not.toBeInTheDocument();
  });

  it("shows the throttle row once debug mode is on", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showDebug: true }),
    );
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    expect(screen.getByText("Throttle inference")).toBeInTheDocument();
  });

  it("toggles and persists the throttle setting from its row", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ showDebug: true }),
    );
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    await user.click(screen.getByText("Throttle inference"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        showDebug: true,
        radarAudio: true,
        throttleInference: false,
      }),
    );
  });
});
