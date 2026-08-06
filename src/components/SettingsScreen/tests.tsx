import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsButton } from "@/components/SettingsButton";
import { SettingsScreen } from "@/components/SettingsScreen";
import {
  DEVELOPER_OPTIONS_OFF,
  SettingsProvider,
  STORAGE_KEY,
} from "@/context/SettingsContext";
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
    expect(screen.queryByText("Scene FoV")).not.toBeInTheDocument();
    expect(screen.queryByText("Video file")).not.toBeInTheDocument();
    // The driver-facing rows are not developer rows and stay put.
    expect(screen.getByText("Audio alerts")).toBeInTheDocument();
    expect(screen.getByText("Detection image")).toBeInTheDocument();
    expect(screen.getByTestId("open-model-screen")).toBeInTheDocument();
  });

  it("reveals every developer row once developer options are on", async () => {
    await renderOpenSettingsWithDeveloperOptions();
    for (const { label } of TOGGLE_ROWS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("Zoom")).toBeInTheDocument();
    expect(screen.getByText("Min confidence")).toBeInTheDocument();
    expect(screen.getByText("Scene FoV")).toBeInTheDocument();
    expect(screen.getByText("Video file")).toBeInTheDocument();
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

  it("persists a lens picked from the Scene FoV slider", async () => {
    await renderOpenSettingsWithDeveloperOptions();
    const slider = screen.getByRole("slider", { name: /scene fov/i });
    expect(slider).toHaveValue(String(DEVELOPER_OPTIONS_OFF.sceneFov));
    fireEvent.change(slider, { target: { value: "75" } });
    expect(stored("sceneFov")).toBe(75);
  });

  it("opens the model screen without developer options", async () => {
    const user = await renderOpenSettings();
    await user.click(screen.getByTestId("open-model-screen"));
    expect(screen.getByTestId("model-back")).toBeInTheDocument();
  });

  // The selection used to be a developer option, so with the master switch off
  // the row named the shipping model however it was set. It is driver-facing
  // now: the row has to name the model the app actually loads.
  it("names an added model on the row with developer options off", async () => {
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
    expect(screen.getByTestId("open-model-screen")).toHaveTextContent(
      added.slug,
    );
  });

  it("names the camera as the feed until a clip is picked", async () => {
    await renderOpenSettingsWithDeveloperOptions();
    expect(screen.getByTestId("video-file-value")).toHaveTextContent("Camera");
    expect(
      screen.queryByRole("button", { name: "CLEAR" }),
    ).not.toBeInTheDocument();
  });

  it("scans a picked clip and names it, with a way back to the camera", async () => {
    const user = await renderOpenSettingsWithDeveloperOptions();
    await user.upload(
      screen.getByTestId("video-file-input"),
      new File(["x"], "drive.mp4", { type: "video/mp4" }),
    );
    expect(screen.getByTestId("video-file-value")).toHaveTextContent(
      "drive.mp4",
    );
    await user.click(screen.getByRole("button", { name: "CLEAR" }));
    expect(screen.getByTestId("video-file-value")).toHaveTextContent("Camera");
  });

  // The CLEAR button goes with the developer rows, so a clip left running
  // would strand the session on canned footage with a reload as the way out.
  it("returns a picked clip to the camera when developer options go off", async () => {
    const user = await renderOpenSettingsWithDeveloperOptions();
    await user.upload(
      screen.getByTestId("video-file-input"),
      new File(["x"], "drive.mp4", { type: "video/mp4" }),
    );
    await user.click(screen.getByText("Developer options"));
    expect(screen.queryByText("Video file")).not.toBeInTheDocument();
    await user.click(screen.getByText("Developer options"));
    expect(screen.getByTestId("video-file-value")).toHaveTextContent("Camera");
  });

  // Turning the switch off on the camera must not churn the feed: a swap
  // detaches the engine's video and mints a new feed id, which drops the
  // camera failure and preview element the current session is holding.
  it("leaves the camera feed alone when developer options go off", async () => {
    const user = await renderOpenSettingsWithDeveloperOptions();
    detachVideo.mockClear();
    await user.click(screen.getByText("Developer options"));
    expect(detachVideo).not.toHaveBeenCalled();
  });
});
