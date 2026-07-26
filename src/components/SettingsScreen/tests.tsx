import { fireEvent, render, screen } from "@testing-library/react";
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
        developerOptions: false,
        showDebug: true,
        frameThumbnails: true,
        saveFrames: true,
        autoSaveFrames: false,
        radarAudio: false,
        throttleInference: true,
        zoomMode: "auto",
        confidenceThreshold: 0.5,
        zoomIndicator: true,
        roundTripIndicator: true,
      }),
    );
  });

  it("toggles and persists the debug setting from the Debug overlay row", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true }),
    );
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    // The overlay is on by default under developer options, so the tap turns
    // it off.
    await user.click(screen.getByText("Debug overlay"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        developerOptions: true,
        showDebug: false,
        frameThumbnails: true,
        saveFrames: true,
        autoSaveFrames: false,
        radarAudio: true,
        throttleInference: true,
        zoomMode: "auto",
        confidenceThreshold: 0.5,
        zoomIndicator: true,
        roundTripIndicator: true,
      }),
    );
  });

  it("toggles and persists developer options from its row", async () => {
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    await user.click(screen.getByText("Developer options"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        developerOptions: true,
        showDebug: true,
        frameThumbnails: true,
        saveFrames: true,
        autoSaveFrames: false,
        radarAudio: true,
        throttleInference: true,
        zoomMode: "auto",
        confidenceThreshold: 0.5,
        zoomIndicator: true,
        roundTripIndicator: true,
      }),
    );
  });

  it("hides every developer row while developer options are off", async () => {
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    expect(screen.queryByText("Debug overlay")).not.toBeInTheDocument();
    expect(screen.queryByText("Zoom indicator")).not.toBeInTheDocument();
    expect(screen.queryByText("Round-trip")).not.toBeInTheDocument();
    expect(screen.queryByText("Frame preview")).not.toBeInTheDocument();
    expect(screen.queryByText("Save frames")).not.toBeInTheDocument();
    expect(screen.queryByText("Auto save")).not.toBeInTheDocument();
    expect(screen.queryByText("Throttle inference")).not.toBeInTheDocument();
    expect(screen.queryByText("Zoom")).not.toBeInTheDocument();
  });

  it("reveals every developer row once developer options are on", async () => {
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    await user.click(screen.getByText("Developer options"));
    expect(screen.getByText("Debug overlay")).toBeInTheDocument();
    expect(screen.getByText("Zoom indicator")).toBeInTheDocument();
    expect(screen.getByText("Round-trip")).toBeInTheDocument();
    expect(screen.getByText("Frame preview")).toBeInTheDocument();
    expect(screen.getByText("Save frames")).toBeInTheDocument();
    expect(screen.getByText("Auto save")).toBeInTheDocument();
    expect(screen.getByText("Throttle inference")).toBeInTheDocument();
    expect(screen.getByText("Zoom")).toBeInTheDocument();
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

  it("toggles and persists the zoom indicator setting from its row", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true }),
    );
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    // On by default under developer options, so the tap turns it off.
    await user.click(screen.getByText("Zoom indicator"));
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")
        .zoomIndicator,
    ).toBe(false);
  });

  it("toggles and persists the round-trip indicator setting from its row", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true }),
    );
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    // On by default under developer options, so the tap turns it off.
    await user.click(screen.getByText("Round-trip"));
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")
        .roundTripIndicator,
    ).toBe(false);
  });

  it("toggles and persists the throttle setting from its row", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true }),
    );
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    await user.click(screen.getByText("Throttle inference"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        developerOptions: true,
        showDebug: true,
        frameThumbnails: true,
        saveFrames: true,
        autoSaveFrames: false,
        radarAudio: true,
        throttleInference: false,
        zoomMode: "auto",
        confidenceThreshold: 0.5,
        zoomIndicator: true,
        roundTripIndicator: true,
      }),
    );
  });

  it("selects and persists a zoom mode from the segmented Zoom row", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true }),
    );
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    await user.click(screen.getByRole("button", { name: "2X" }));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        developerOptions: true,
        showDebug: true,
        frameThumbnails: true,
        saveFrames: true,
        autoSaveFrames: false,
        radarAudio: true,
        throttleInference: true,
        zoomMode: "2x",
        confidenceThreshold: 0.5,
        zoomIndicator: true,
        roundTripIndicator: true,
      }),
    );
  });

  it("offers all three zoom modes and returns to 1x on tap", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true, zoomMode: "auto" }),
    );
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    expect(screen.getByRole("button", { name: "1X" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2X" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AUTO" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "1X" }));
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}").zoomMode,
    ).toBe("1x");
  });

  it("toggles and persists the frame preview setting from its row", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true }),
    );
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    await user.click(screen.getByText("Frame preview"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        developerOptions: true,
        showDebug: true,
        frameThumbnails: false,
        saveFrames: true,
        autoSaveFrames: false,
        radarAudio: true,
        throttleInference: true,
        zoomMode: "auto",
        confidenceThreshold: 0.5,
        zoomIndicator: true,
        roundTripIndicator: true,
      }),
    );
  });

  it("toggles and persists the frame saving setting from its row", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true }),
    );
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    await user.click(screen.getByText("Save frames"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        developerOptions: true,
        showDebug: true,
        frameThumbnails: true,
        saveFrames: false,
        autoSaveFrames: false,
        radarAudio: true,
        throttleInference: true,
        zoomMode: "auto",
        confidenceThreshold: 0.5,
        zoomIndicator: true,
        roundTripIndicator: true,
      }),
    );
  });

  it("toggles and persists the auto save setting from its row", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true }),
    );
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    await user.click(screen.getByText("Auto save"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({
        developerOptions: true,
        showDebug: true,
        frameThumbnails: true,
        saveFrames: true,
        autoSaveFrames: true,
        radarAudio: true,
        throttleInference: true,
        zoomMode: "auto",
        confidenceThreshold: 0.5,
        zoomIndicator: true,
        roundTripIndicator: true,
      }),
    );
  });

  it("hides the Min confidence row while developer options are off", async () => {
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    expect(screen.queryByText("Min confidence")).not.toBeInTheDocument();
  });

  it("shows the Min confidence slider under developer options and updates on change", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true }),
    );
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    const slider = screen.getByRole("slider", { name: /min confidence/i });
    expect(slider).toHaveValue("0.5");
    fireEvent.change(slider, { target: { value: "0.3" } });
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")
        .confidenceThreshold,
    ).toBe(0.3);
  });
});
