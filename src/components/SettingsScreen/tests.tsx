import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsButton } from "@/components/SettingsButton";
import { SettingsScreen } from "@/components/SettingsScreen";
import {
  DEVELOPER_OPTIONS_OFF,
  SettingsProvider,
  STORAGE_KEY,
} from "@/context/SettingsContext";
import type { PersistedSettings } from "@/context/SettingsContext";
import { DEFAULT_MODEL } from "@/lib/detectionModels";

vi.mock("@/context/DetectionContext", () => ({
  useDetection: () => ({ activeModel: DEFAULT_MODEL }),
}));

afterEach(() => {
  window.localStorage.clear();
});

/** The settings field currently persisted to localStorage. */
const stored = <K extends keyof PersistedSettings>(key: K) =>
  JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")[key];

/** Renders the settings panel under the providers it consumes. */
const renderScreen = () =>
  render(
    <SettingsProvider>
      <SettingsButton />
      <SettingsScreen />
    </SettingsProvider>,
  );

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /open settings/i }));
};

/** Opens the settings panel with developer options already on. */
const renderOpenSettingsWithDeveloperOptions = async () => {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ developerOptions: true }),
  );
  const user = userEvent.setup();
  renderScreen();
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

/**
 * Every toggle row, the settings field it writes, and the value one tap leaves
 * behind. A row wired to the wrong field is silent in the UI, so this is the
 * guard that each one reaches its own setting.
 */
const TOGGLE_ROWS: ReadonlyArray<{
  label: string;
  key: keyof PersistedSettings;
  afterTap: boolean;
  developer: boolean;
}> = [
  {
    label: "Audio alerts",
    key: "radarAudio",
    afterTap: false,
    developer: false,
  },
  {
    label: "Detection image",
    key: "detectionImage",
    afterTap: true,
    developer: false,
  },
  {
    label: "Developer options",
    key: "developerOptions",
    afterTap: true,
    developer: false,
  },
  { label: "Debug overlay", key: "showDebug", afterTap: true, developer: true },
  {
    label: "Zoom indicator",
    key: "zoomIndicator",
    afterTap: true,
    developer: true,
  },
  {
    label: "Round-trip",
    key: "roundTripIndicator",
    afterTap: true,
    developer: true,
  },
  {
    label: "Camera preview",
    key: "cameraPreview",
    afterTap: true,
    developer: true,
  },
  {
    label: "Detection view",
    key: "detectionView",
    afterTap: true,
    developer: true,
  },
  {
    label: "Throttle inference",
    key: "throttleInference",
    afterTap: false,
    developer: true,
  },
  {
    label: "Frame preview",
    key: "frameThumbnails",
    afterTap: true,
    developer: true,
  },
  { label: "Save frames", key: "saveFrames", afterTap: true, developer: true },
  {
    label: "Auto save",
    key: "autoSaveFrames",
    afterTap: true,
    developer: true,
  },
];

describe("SettingsScreen", () => {
  it("renders nothing until the panel is opened", async () => {
    const user = userEvent.setup();
    renderScreen();
    expect(screen.queryByText("Audio alerts")).not.toBeInTheDocument();
    await open(user);
    expect(screen.getByText("Audio alerts")).toBeInTheDocument();
  });

  it.each(TOGGLE_ROWS)(
    "writes $key when the $label row is tapped",
    async ({ label, key, afterTap, developer }) => {
      const user = developer
        ? await renderOpenSettingsWithDeveloperOptions()
        : await renderOpenSettings();
      await user.click(screen.getByText(label));
      expect(stored(key)).toBe(afterTap);
    },
  );

  it("hides every developer row while developer options are off", async () => {
    await renderOpenSettings();
    for (const { label, developer } of TOGGLE_ROWS) {
      if (developer) {
        expect(screen.queryByText(label)).not.toBeInTheDocument();
      }
    }
    expect(screen.queryByText("Zoom")).not.toBeInTheDocument();
    expect(screen.queryByText("Min confidence")).not.toBeInTheDocument();
    expect(screen.queryByTestId("open-model-screen")).toBeNull();
    // The two driver-facing rows are not developer rows and stay put.
    expect(screen.getByText("Audio alerts")).toBeInTheDocument();
    expect(screen.getByText("Detection image")).toBeInTheDocument();
  });

  it("reveals every developer row once developer options are on", async () => {
    await renderOpenSettingsWithDeveloperOptions();
    for (const { label } of TOGGLE_ROWS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("Zoom")).toBeInTheDocument();
    expect(screen.getByText("Min confidence")).toBeInTheDocument();
  });

  it("closes on the close button", async () => {
    const user = await renderOpenSettings();
    await user.click(screen.getByRole("button", { name: /close settings/i }));
    expect(screen.queryByText("Audio alerts")).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = await renderOpenSettings();
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Audio alerts")).not.toBeInTheDocument();
  });

  // Escape used to close the panel outright from the model screen. This
  // component is rendered unconditionally and only returns null, so it never
  // unmounts: the sub-screen flag survived, and reopening settings landed on
  // the picker instead of the panel.
  it("backs out of the model screen on Escape before closing the panel", async () => {
    const user = await renderOpenSettingsWithDeveloperOptions();
    await user.click(screen.getByTestId("open-model-screen"));
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("model-back")).toBeNull();
    expect(screen.getByText("Audio alerts")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Audio alerts")).not.toBeInTheDocument();
  });

  it("persists the mode picked from the segmented Zoom row", async () => {
    const user = await renderOpenSettingsWithDeveloperOptions();
    await user.click(screen.getByRole("button", { name: "2X" }));
    expect(stored("zoomMode")).toBe("2x");
    await user.click(screen.getByRole("button", { name: "1X" }));
    expect(stored("zoomMode")).toBe("1x");
  });

  it("persists a confidence picked from the Min confidence slider", async () => {
    await renderOpenSettingsWithDeveloperOptions();
    const slider = screen.getByRole("slider", { name: /min confidence/i });
    expect(slider).toHaveValue(
      String(DEVELOPER_OPTIONS_OFF.confidenceThreshold),
    );
    fireEvent.change(slider, { target: { value: "0.3" } });
    expect(stored("confidenceThreshold")).toBe(0.3);
  });

  it("opens the model screen from the developer row", async () => {
    const user = await renderOpenSettingsWithDeveloperOptions();
    await user.click(screen.getByTestId("open-model-screen"));
    expect(screen.getByTestId("model-back")).toBeInTheDocument();
  });
});
