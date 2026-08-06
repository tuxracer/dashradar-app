import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeveloperScreen } from "@/components/DeveloperScreen";
import {
  addStoredModel,
  DEFAULT_MODEL,
  pinnedModel,
} from "@/lib/detectionModels";
import {
  DEVELOPER_OPTIONS_OFF,
  SettingsProvider,
  STORAGE_KEY,
} from "@/context/SettingsContext";
import type { PersistedSettings } from "@/context/SettingsContext";
import { VideoSourceProvider } from "@/context/VideoSourceContext";

/** The video source provider detaches the engine's video on a swap. */
const detachVideo = vi.fn();
vi.mock("@/context/DetectionContext", () => ({
  useDetection: () => ({ detachVideo }),
}));

beforeEach(() => {
  // jsdom implements neither, and a picked clip is played from an object URL.
  URL.createObjectURL = vi.fn(() => "blob:mock/clip");
  URL.revokeObjectURL = vi.fn();
  onClose.mockClear();
  onOpenModel.mockClear();
});

afterEach(() => {
  window.localStorage.clear();
});

/** The settings field currently persisted to localStorage. */
const stored = <K extends keyof PersistedSettings>(key: K) =>
  JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")[key];

const onClose = vi.fn();
const onOpenModel = vi.fn();

/** Renders the developer screen under the providers it consumes. */
const renderScreen = () => {
  render(
    <SettingsProvider>
      <VideoSourceProvider>
        <DeveloperScreen onClose={onClose} onOpenModel={onOpenModel} />
      </VideoSourceProvider>
    </SettingsProvider>,
  );
  return userEvent.setup();
};

/** Renders the screen with the master switch already on. */
const renderEnabled = () => {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ developerOptions: true }),
  );
  return renderScreen();
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
}> = [
  { label: "Debug overlay", key: "showDebug", afterTap: true },
  { label: "Zoom indicator", key: "zoomIndicator", afterTap: true },
  { label: "Round-trip", key: "roundTripIndicator", afterTap: true },
  { label: "Raw confidence", key: "rawConfidence", afterTap: true },
  { label: "Camera preview", key: "cameraPreview", afterTap: true },
  { label: "Detection view", key: "detectionView", afterTap: true },
  { label: "Throttle inference", key: "throttleInference", afterTap: false },
  { label: "Skip still frames", key: "sceneChangeGate", afterTap: false },
];

/** Rows that are not toggles, named by the text that identifies them. */
const OTHER_ROWS = [
  "Zoom",
  "Min confidence",
  "Scene FoV",
  "Video file",
  "Reset app data",
];

describe("DeveloperScreen", () => {
  it.each(TOGGLE_ROWS)(
    "writes $key when the $label row is tapped",
    async ({ label, key, afterTap }) => {
      const user = renderEnabled();
      await user.click(screen.getByText(label));
      expect(stored(key)).toBe(afterTap);
    },
  );

  it("writes developerOptions when the master switch is tapped", async () => {
    const user = renderScreen();
    await user.click(screen.getByText("Enable developer options"));
    expect(stored("developerOptions")).toBe(true);
  });

  it("hides every row behind the master switch", () => {
    renderScreen();
    for (const { label } of TOGGLE_ROWS) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    for (const label of OTHER_ROWS) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    // The switch itself is the one row that is always here; without it there
    // would be no way to reveal the rest.
    expect(screen.getByText("Enable developer options")).toBeInTheDocument();
  });

  it("reveals every row once the master switch is on", () => {
    renderEnabled();
    for (const { label } of TOGGLE_ROWS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const label of OTHER_ROWS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("returns to the settings panel from BACK", async () => {
    const user = renderScreen();
    onClose.mockClear();
    await user.click(screen.getByTestId("developer-back"));
    expect(onClose).toHaveBeenCalled();
  });

  it("persists the mode picked from the segmented Zoom row", async () => {
    const user = renderEnabled();
    await user.click(screen.getByRole("button", { name: "2X" }));
    expect(stored("zoomMode")).toBe("2x");
    await user.click(screen.getByRole("button", { name: "1X" }));
    expect(stored("zoomMode")).toBe("1x");
  });

  it("persists a confidence picked from the Min confidence slider", () => {
    renderEnabled();
    const slider = screen.getByRole("slider", { name: /min confidence/i });
    expect(slider).toHaveValue(
      String(DEVELOPER_OPTIONS_OFF.confidenceThreshold),
    );
    fireEvent.change(slider, { target: { value: "0.3" } });
    expect(stored("confidenceThreshold")).toBe(0.3);
  });

  it("persists a lens picked from the Scene FoV slider", () => {
    renderEnabled();
    const slider = screen.getByRole("slider", { name: /scene fov/i });
    expect(slider).toHaveValue(String(DEVELOPER_OPTIONS_OFF.sceneFov));
    fireEvent.change(slider, { target: { value: "75" } });
    expect(stored("sceneFov")).toBe(75);
  });

  it("names the camera as the feed until a clip is picked", () => {
    renderEnabled();
    expect(screen.getByTestId("video-file-value")).toHaveTextContent("Camera");
    expect(
      screen.queryByRole("button", { name: "CLEAR" }),
    ).not.toBeInTheDocument();
  });

  it("scans a picked clip and names it, with a way back to the camera", async () => {
    const user = renderEnabled();
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

  // The CLEAR button is one of the rows the master switch hides, so a clip left
  // running would strand the session on canned footage with a reload as the way
  // out.
  it("returns a picked clip to the camera when the master switch goes off", async () => {
    const user = renderEnabled();
    await user.upload(
      screen.getByTestId("video-file-input"),
      new File(["x"], "drive.mp4", { type: "video/mp4" }),
    );
    await user.click(screen.getByText("Enable developer options"));
    expect(screen.queryByText("Video file")).not.toBeInTheDocument();
    await user.click(screen.getByText("Enable developer options"));
    expect(screen.getByTestId("video-file-value")).toHaveTextContent("Camera");
  });

  // Turning the switch off on the camera must not churn the feed: a swap
  // detaches the engine's video and mints a new feed id, which drops the
  // camera failure and preview element the current session is holding.
  it("leaves the camera feed alone when the master switch goes off", async () => {
    const user = renderEnabled();
    detachVideo.mockClear();
    await user.click(screen.getByText("Enable developer options"));
    expect(detachVideo).not.toHaveBeenCalled();
  });
});

describe("the Detection model row", () => {
  it("stays behind the master switch with the rest of them", async () => {
    const user = renderScreen();
    expect(screen.queryByTestId("open-model-screen")).toBeNull();
    await user.click(screen.getByText("Enable developer options"));
    expect(screen.getByTestId("open-model-screen")).toBeInTheDocument();
  });

  // A repo slug is far longer than the space a row leaves beside its label, so
  // naming the model here wrapped onto a second line; the picker the row opens
  // is where a model is named.
  it("names no model", async () => {
    const added = pinnedModel({
      owner: "someone",
      slug: "other-detector",
      revision: "abc123",
      file: "model.onnx",
    });
    addStoredModel(added);
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ developerOptions: true, modelIds: [added.id] }),
    );
    renderScreen();
    const row = screen.getByTestId("open-model-screen");
    expect(row).not.toHaveTextContent(added.slug);
    expect(row).not.toHaveTextContent(DEFAULT_MODEL.slug);
  });

  it("hands the picker to whoever owns the screen stack", async () => {
    const user = renderEnabled();
    await user.click(screen.getByTestId("open-model-screen"));
    expect(onOpenModel).toHaveBeenCalled();
  });
});
