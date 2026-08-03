import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelScreen } from "@/components/ModelScreen";
import { SettingsProvider, STORAGE_KEY } from "@/context/SettingsContext";
import type { PersistedSettings } from "@/context/SettingsContext";
import type { DetectionModel } from "@/lib/detectionModels";

/**
 * Stands in for the model the running session pinned at mount. The real
 * provider needs a worker and a camera, and the pin is the only thing this
 * screen reads from it.
 */
vi.mock("@/context/DetectionContext", () => ({
  useDetection: () => ({ activeModel: running }),
}));

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

/** A registry that does not ship, so a selection can actually be changed. */
const MODELS: readonly DetectionModel[] = [
  {
    id: "alpha",
    owner: "tuxracer",
    slug: "alpha-repo",
    revision: "v1",
    file: "onnx/alpha.onnx",
  },
  {
    id: "beta",
    owner: "tuxracer",
    slug: "beta-repo",
    revision: "v2",
    file: "onnx/beta.onnx",
  },
];

/** What the mocked session reports it is running, reset before every test. */
let running: DetectionModel = MODELS[0];

beforeEach(() => {
  running = MODELS[0];
});

/** The settings field currently persisted to localStorage. */
const stored = <K extends keyof PersistedSettings>(key: K) =>
  JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")[key];

const wrapper = ({ children }: { children: ReactNode }) => (
  <SettingsProvider>{children}</SettingsProvider>
);

/**
 * Mounts the screen over a developer-options-on blob, `alpha` selected unless
 * the test stores something else.
 */
const mount = (props?: {
  onClose?: () => void;
  reload?: () => void;
  modelIds?: readonly string[];
}) => {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      developerOptions: true,
      modelIds: props?.modelIds ?? ["alpha"],
    }),
  );
  return render(
    <ModelScreen
      onClose={props?.onClose ?? vi.fn()}
      models={MODELS}
      reload={props?.reload ?? vi.fn()}
    />,
    { wrapper },
  );
};

describe("ModelScreen", () => {
  it("offers no save until the draft differs from the running model", async () => {
    mount();
    expect(screen.getByTestId("model-save")).toBeDisabled();
    await userEvent.click(screen.getByTestId("model-option-beta"));
    expect(screen.getByTestId("model-save")).toBeEnabled();
  });

  it("offers save when the stored selection is not what the session is running", () => {
    // What a developer sees after turning developer options on mid-session:
    // the stored pick was invisible when the session pinned its model, so the
    // picker shows a model the detector is not running and Save is the route
    // to making that true.
    mount({ modelIds: ["beta"] });
    expect(screen.getByTestId("model-save")).toBeEnabled();
  });

  it("keeps a model selected when its own row is tapped again", async () => {
    mount();
    await userEvent.click(screen.getByTestId("model-option-alpha"));
    // Nothing selected would leave no model to load, so the tap is a no-op and
    // there is no emptied selection to save.
    expect(screen.getByTestId("model-save")).toBeDisabled();
  });

  it("selecting past the cap replaces the selection rather than adding to it", async () => {
    const reload = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mount({ reload });
    await userEvent.click(screen.getByTestId("model-option-beta"));
    await userEvent.click(screen.getByTestId("model-save"));
    expect(stored("modelIds")).toEqual(["beta"]);
  });

  it("writes nothing and stays put when the confirm is declined", async () => {
    const reload = vi.fn();
    const onClose = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    mount({ reload, onClose });
    await userEvent.click(screen.getByTestId("model-option-beta"));
    await userEvent.click(screen.getByTestId("model-save"));
    expect(stored("modelIds")).toEqual(["alpha"]);
    expect(reload).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("reloads once the selection is committed", async () => {
    const reload = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mount({ reload });
    await userEvent.click(screen.getByTestId("model-option-beta"));
    await userEvent.click(screen.getByTestId("model-save"));
    expect(reload).toHaveBeenCalled();
  });

  it("does not reload when storage refuses the write", async () => {
    const reload = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    mount({ reload });
    await userEvent.click(screen.getByTestId("model-option-beta"));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    await userEvent.click(screen.getByTestId("model-save"));
    expect(reload).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalled();
  });

  it("discards the draft on back", async () => {
    const onClose = vi.fn();
    mount({ onClose });
    await userEvent.click(screen.getByTestId("model-option-beta"));
    await userEvent.click(screen.getByTestId("model-back"));
    expect(stored("modelIds")).toEqual(["alpha"]);
    expect(onClose).toHaveBeenCalled();
  });
});
