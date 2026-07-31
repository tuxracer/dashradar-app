import { useEffect } from "react";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsButton } from "@/components/SettingsButton";
import { SettingsScreen } from "@/components/SettingsScreen";
import { DevVideoProvider, useDevVideo } from "@/context/DevVideoContext";
import {
  SETTINGS_VERSION,
  SettingsProvider,
  STORAGE_KEY,
} from "@/context/SettingsContext";
import type { PersistedSettings } from "@/context/SettingsContext";
import { MODEL_REVISION } from "@/workers/detection/consts";

/** Stands in for DetectionContext's feed swap, which needs no worker here. */
const swapVideoSource = vi.fn();

vi.mock("@/context/DetectionContext", () => ({
  useDetection: () => ({ swapVideoSource }),
}));

afterEach(() => {
  window.localStorage.clear();
});

beforeEach(() => {
  swapVideoSource.mockClear();
  let created = 0;
  // jsdom implements neither, and DevVideoProvider's whole job is their
  // lifecycle.
  URL.createObjectURL = vi.fn(() => `blob:mock/${(created += 1)}`);
  URL.revokeObjectURL = vi.fn();
});

/**
 * The blob a fresh install writes to localStorage, with the rows a test changed
 * spread over it. Written in the key order SettingsProvider persists, so the
 * result compares against the stored JSON string directly.
 */
const persisted = (overrides: Partial<PersistedSettings> = {}) =>
  JSON.stringify({
    settingsVersion: SETTINGS_VERSION,
    developerOptions: false,
    showDebug: false,
    frameThumbnails: false,
    saveFrames: false,
    autoSaveFrames: false,
    radarAudio: true,
    detectionImage: true,
    throttleInference: true,
    zoomMode: "auto",
    confidenceThreshold: 0.5,
    zoomIndicator: false,
    roundTripIndicator: false,
    cameraPreview: false,
    rawConfidence: false,
    ...overrides,
  });

/**
 * Calls the real DevVideoProvider's `setVideoFile` once on mount, so a test
 * needing an "already overridden" row exercises actual context state instead
 * of a mocked context value.
 */
const DevVideoSeed = ({ file }: { file: File }) => {
  const { setVideoFile } = useDevVideo();
  useEffect(() => {
    setVideoFile(file);
  }, [file, setVideoFile]);
  return null;
};

/** Renders the settings panel under the providers it consumes, `extra` mounted alongside for tests that need to seed real context state before the panel opens. */
const renderScreen = (extra?: ReactNode) =>
  render(
    <SettingsProvider>
      <DevVideoProvider>
        {extra}
        <SettingsButton />
        <SettingsScreen />
      </DevVideoProvider>
    </SettingsProvider>,
  );

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /open settings/i }));
};

/**
 * Opens the settings panel with developer options already on. Pass a file to
 * seed a real override through DevVideoProvider before the panel opens, so
 * the "already overridden" row state comes from actual context.
 */
const renderOpenSettingsWithDeveloperOptions = async (file?: File) => {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ developerOptions: true }),
  );
  const user = userEvent.setup();
  renderScreen(file ? <DevVideoSeed file={file} /> : undefined);
  await open(user);
  return user;
};

/** Opens the settings panel with developer options left off. */
const renderOpenSettings = async () => {
  const user = userEvent.setup();
  renderScreen();
  await open(user);
  return user;
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
      persisted({ radarAudio: false }),
    );
  });

  // A normal-drive row, so it sits beside Audio alerts rather than behind the
  // Developer options switch.
  it("toggles and persists the detection image from its row", async () => {
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    await user.click(screen.getByText("Detection image"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      persisted({ detectionImage: false }),
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
    // The overlay starts off under developer options, so the tap turns it on.
    await user.click(screen.getByText("Debug overlay"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      persisted({ developerOptions: true, showDebug: true }),
    );
  });

  it("toggles and persists developer options from its row", async () => {
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    await user.click(screen.getByText("Developer options"));
    // The master switch changes nothing but itself: every developer row is
    // stored exactly as it was.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      persisted({ developerOptions: true }),
    );
  });

  it("hides every developer row while developer options are off", async () => {
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    expect(screen.queryByText("Debug overlay")).not.toBeInTheDocument();
    expect(screen.queryByText("Zoom indicator")).not.toBeInTheDocument();
    expect(screen.queryByText("Round-trip")).not.toBeInTheDocument();
    expect(screen.queryByText("Camera preview")).not.toBeInTheDocument();
    expect(screen.queryByText("Frame preview")).not.toBeInTheDocument();
    expect(screen.queryByText("Save frames")).not.toBeInTheDocument();
    expect(screen.queryByText("Auto save")).not.toBeInTheDocument();
    expect(screen.queryByText("Throttle inference")).not.toBeInTheDocument();
    expect(screen.queryByText("Zoom")).not.toBeInTheDocument();
    // The two driver-facing rows are not developer rows and stay put.
    expect(screen.getByText("Audio alerts")).toBeInTheDocument();
    expect(screen.getByText("Detection image")).toBeInTheDocument();
  });

  it("reveals every developer row once developer options are on", async () => {
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    await user.click(screen.getByText("Developer options"));
    expect(screen.getByText("Debug overlay")).toBeInTheDocument();
    expect(screen.getByText("Zoom indicator")).toBeInTheDocument();
    expect(screen.getByText("Round-trip")).toBeInTheDocument();
    expect(screen.getByText("Camera preview")).toBeInTheDocument();
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
    await user.click(screen.getByText("Zoom indicator"));
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")
        .zoomIndicator,
    ).toBe(true);
  });

  it("toggles and persists the round-trip indicator setting from its row", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true }),
    );
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    await user.click(screen.getByText("Round-trip"));
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")
        .roundTripIndicator,
    ).toBe(true);
  });

  it("toggles and persists the camera preview setting from its row", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true }),
    );
    const user = userEvent.setup();
    renderScreen();
    await open(user);
    await user.click(screen.getByText("Camera preview"));
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")
        .cameraPreview,
    ).toBe(true);
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
      persisted({ developerOptions: true, throttleInference: false }),
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
      persisted({ developerOptions: true, zoomMode: "2x" }),
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
      persisted({ developerOptions: true, frameThumbnails: true }),
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
      persisted({ developerOptions: true, saveFrames: true }),
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
      persisted({ developerOptions: true, autoSaveFrames: true }),
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

  it("shows the camera as the feed until a file is chosen", async () => {
    await renderOpenSettingsWithDeveloperOptions();
    expect(screen.getByTestId("video-file-value")).toHaveTextContent("Camera");
    expect(screen.queryByRole("button", { name: "CLEAR" })).toBeNull();
  });

  it("swaps the feed to a picked file and offers to clear it", async () => {
    await renderOpenSettingsWithDeveloperOptions();
    const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
    await userEvent.upload(screen.getByTestId("video-file-input"), file);
    expect(swapVideoSource).toHaveBeenCalledWith(file);
  });

  it("clears back to the camera", async () => {
    const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
    await renderOpenSettingsWithDeveloperOptions(file);
    expect(screen.getByTestId("video-file-value")).toHaveTextContent(
      "clip.mp4",
    );
    await userEvent.click(screen.getByRole("button", { name: "CLEAR" }));
    expect(swapVideoSource).toHaveBeenCalledWith(null);
  });

  it("hides the row when developer options are off", async () => {
    await renderOpenSettings();
    expect(screen.queryByTestId("video-file-value")).toBeNull();
  });

  // Turning the master switch off used to take the row (and with it the only
  // CLEAR button) away while the override survived, stranding the session on a
  // canned clip with no way back to the camera short of a reload.
  it("keeps the row reachable when developer options go off with a clip playing", async () => {
    const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
    const user = await renderOpenSettingsWithDeveloperOptions(file);
    await user.click(screen.getByText("Developer options"));

    expect(screen.queryByText("Debug overlay")).not.toBeInTheDocument();
    expect(screen.getByTestId("video-file-value")).toHaveTextContent(
      "clip.mp4",
    );
    await user.click(screen.getByRole("button", { name: "CLEAR" }));
    expect(swapVideoSource).toHaveBeenCalledWith(null);
  });
});
