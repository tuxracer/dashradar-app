import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsButton } from "@/components/SettingsButton";
import { SettingsScreen } from "@/components/SettingsScreen";
import { SettingsProvider, STORAGE_KEY } from "@/context/SettingsContext";
import type { PersistedSettings } from "@/context/SettingsContext";
import { VideoSourceProvider } from "@/context/VideoSourceContext";
import {
  addStoredModel,
  DEFAULT_MODEL,
  pinnedModel,
} from "@/lib/detectionModels";

/**
 * The model screen reads the running model from DetectionContext and the video
 * source provider detaches the engine's video on a swap; neither needs a worker
 * here.
 */
const detachVideo = vi.fn();
vi.mock("@/context/DetectionContext", () => ({
  useDetection: () => ({ activeModel: DEFAULT_MODEL, detachVideo }),
}));

beforeEach(() => {
  // jsdom implements neither, and a picked clip is played from an object URL.
  URL.createObjectURL = vi.fn(() => "blob:mock/clip");
  URL.revokeObjectURL = vi.fn();
});

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
      <VideoSourceProvider>
        <SettingsButton />
        <SettingsScreen />
      </VideoSourceProvider>
    </SettingsProvider>,
  );

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /open settings/i }));
};

/** Opens the settings panel. */
const renderOpenSettings = async () => {
  const user = userEvent.setup();
  renderScreen();
  await open(user);
  return user;
};

/**
 * Every toggle row the panel itself owns, the settings field it writes, and the
 * value one tap leaves behind. A row wired to the wrong field is silent in the
 * UI, so this is the guard that each one reaches its own setting.
 */
const TOGGLE_ROWS: ReadonlyArray<{
  label: string;
  key: keyof PersistedSettings;
  afterTap: boolean;
}> = [
  { label: "Audio alerts", key: "radarAudio", afterTap: false },
  { label: "Detection image", key: "detectionImage", afterTap: true },
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
    async ({ label, key, afterTap }) => {
      const user = await renderOpenSettings();
      await user.click(screen.getByText(label));
      expect(stored(key)).toBe(afterTap);
    },
  );

  // The developer rows moved behind their own screen. The panel must not carry
  // any of them, whatever the master switch says, or the split it was given
  // would only be half done.
  it("keeps every developer row off the panel", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true }),
    );
    await renderOpenSettings();
    for (const label of [
      "Debug overlay",
      "Zoom indicator",
      "Round-trip",
      "Camera preview",
      "Detection view",
      "Throttle inference",
      "Zoom",
      "Min confidence",
      "Scene FoV",
      "Video file",
      "Reset app data",
    ]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    // The driver-facing rows are what is left.
    expect(screen.getByText("Audio alerts")).toBeInTheDocument();
    expect(screen.getByText("Detection image")).toBeInTheDocument();
    expect(screen.getByTestId("open-model-screen")).toBeInTheDocument();
    expect(screen.getByTestId("open-developer-screen")).toBeInTheDocument();
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
    const user = await renderOpenSettings();
    await user.click(screen.getByTestId("open-model-screen"));
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("model-back")).toBeNull();
    expect(screen.getByText("Audio alerts")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Audio alerts")).not.toBeInTheDocument();
  });

  // The developer screen is on the same stack as the picker and gets the same
  // treatment; the two share one piece of state, so a regression in either
  // shows up here.
  it("backs out of the developer screen on Escape before closing the panel", async () => {
    const user = await renderOpenSettings();
    await user.click(screen.getByTestId("open-developer-screen"));
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("developer-back")).toBeNull();
    expect(screen.getByText("Audio alerts")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Audio alerts")).not.toBeInTheDocument();
  });

  // The card is a third screen on the same stack, and the panel's Escape
  // handler cannot see it, so one press has to stop at the picker rather than
  // taking both down.
  it("backs out of a model card on Escape before the picker", async () => {
    const user = await renderOpenSettings();
    await user.click(screen.getByTestId("open-model-screen"));
    await user.click(screen.getByTestId(`model-option-${DEFAULT_MODEL.id}`));
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("model-card-use")).toBeNull();
    expect(screen.getByTestId("model-back")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("model-back")).toBeNull();
    expect(screen.getByText("Audio alerts")).toBeInTheDocument();
  });

  it("opens the model screen without developer options", async () => {
    const user = await renderOpenSettings();
    await user.click(screen.getByTestId("open-model-screen"));
    expect(screen.getByTestId("model-back")).toBeInTheDocument();
  });

  // The developer screen is where the master switch lives, so the row that
  // opens it cannot be behind that switch.
  it("opens the developer screen with developer options off", async () => {
    const user = await renderOpenSettings();
    await user.click(screen.getByTestId("open-developer-screen"));
    expect(screen.getByTestId("developer-back")).toBeInTheDocument();
    expect(screen.getByText("Enable developer options")).toBeInTheDocument();
  });

  it("returns to the panel from the developer screen", async () => {
    const user = await renderOpenSettings();
    await user.click(screen.getByTestId("open-developer-screen"));
    await user.click(screen.getByTestId("developer-back"));
    expect(screen.getByText("Audio alerts")).toBeInTheDocument();
    expect(screen.queryByTestId("developer-back")).toBeNull();
  });

  // A repo slug is far longer than the space a settings row leaves beside its
  // label, so naming the model here wrapped onto a second line; the picker the
  // row opens is where a model is named.
  it("names no model on the row", async () => {
    const added = pinnedModel({
      owner: "someone",
      slug: "other-detector",
      revision: "abc123",
      file: "model.onnx",
    });
    addStoredModel(added);
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ modelIds: [added.id] }),
    );
    await renderOpenSettings();
    const row = screen.getByTestId("open-model-screen");
    expect(row).not.toHaveTextContent(added.slug);
    expect(row).not.toHaveTextContent(DEFAULT_MODEL.slug);
  });
});
