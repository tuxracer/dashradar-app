import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsButton } from "@/components/SettingsButton";
import { SettingsScreen } from "@/components/SettingsScreen";
import { SettingsProvider, STORAGE_KEY } from "@/context/SettingsContext";
import type { DetectionBackend } from "@/workers/detection/types";

afterEach(() => {
  window.localStorage.clear();
});

const renderScreen = (
  props: { backend?: DetectionBackend; fps?: number } = {},
) =>
  render(
    <SettingsProvider>
      <SettingsButton />
      <SettingsScreen backend={props.backend} fps={props.fps ?? 0} />
    </SettingsProvider>,
  );

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /open settings/i }));
};

describe("SettingsScreen", () => {
  it("renders nothing until the panel is opened", async () => {
    const user = userEvent.setup();
    renderScreen();
    expect(screen.queryByText("Video feed")).not.toBeInTheDocument();
    await open(user);
    expect(screen.getByText("Video feed")).toBeInTheDocument();
  });

  it("toggles and persists the video setting from the Video feed row", async () => {
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    await user.click(screen.getByText("Video feed"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        showVideo: false,
        showDebug: false,
        stabilizeMotion: false,
        radarDetectorMode: false,
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
        showVideo: true,
        showDebug: true,
        stabilizeMotion: false,
        radarDetectorMode: false,
      }),
    );
  });

  it("toggles and persists the motion setting from the Motion stabilization row", async () => {
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    await user.click(screen.getByText("Motion stabilization"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        showVideo: true,
        showDebug: false,
        stabilizeMotion: true,
        radarDetectorMode: false,
      }),
    );
  });

  it("closes on the close button", async () => {
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    await user.click(screen.getByRole("button", { name: /close settings/i }));
    expect(screen.queryByText("Video feed")).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Video feed")).not.toBeInTheDocument();
  });

  it("shows the GPU engine readout with live fps", async () => {
    const user = userEvent.setup();
    renderScreen({ backend: "webgpu", fps: 11 });
    await open(user);
    expect(screen.getByText("GPU · 11 FPS")).toBeInTheDocument();
  });

  it("shows the CPU engine readout on the wasm fallback", async () => {
    const user = userEvent.setup();
    renderScreen({ backend: "wasm", fps: 4 });
    await open(user);
    expect(screen.getByText("CPU · 4 FPS")).toBeInTheDocument();
  });

  it("shows a starting placeholder before a backend is known", async () => {
    const user = userEvent.setup();
    renderScreen({ backend: undefined, fps: 0 });
    await open(user);
    expect(screen.getByText(/starting/i)).toBeInTheDocument();
  });

  it("shows the model slug and the app version", async () => {
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    expect(
      screen.getByText(/las-vegas-metro-rfdetr-small-t1/),
    ).toBeInTheDocument();
    expect(screen.getByText(/v\d+\.\d+\.\d+/)).toBeInTheDocument();
  });

  it("appends the short commit hash to the version when one is available", async () => {
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    if (__COMMIT_SHA__ === "unknown") {
      expect(screen.getByText(/v\d+\.\d+\.\d+ ↗/)).toBeInTheDocument();
    } else {
      expect(
        screen.getByText(
          new RegExp(`v\\d+\\.\\d+\\.\\d+ · ${__COMMIT_SHA__} ↗`),
        ),
      ).toBeInTheDocument();
    }
  });
});
