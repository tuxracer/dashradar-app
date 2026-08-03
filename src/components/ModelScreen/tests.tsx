import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelScreen } from "@/components/ModelScreen";
import { SettingsProvider, STORAGE_KEY } from "@/context/SettingsContext";
import type { PersistedSettings } from "@/context/SettingsContext";
import type { DetectionModel } from "@/lib/detectionModels";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

/** A registry that does not ship, so a selection can actually be changed. */
const MODELS: readonly DetectionModel[] = [
  {
    id: "alpha",
    slug: "alpha-repo",
    revision: "v1",
    file: "alpha.onnx",
    classes: [{ label: "a", displayLabel: "A", category: "vehicle" }],
  },
  {
    id: "beta",
    slug: "beta-repo",
    revision: "v2",
    file: "beta.onnx",
    classes: [{ label: "b", displayLabel: "B", category: "vehicle" }],
  },
];

/** The settings field currently persisted to localStorage. */
const stored = <K extends keyof PersistedSettings>(key: K) =>
  JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")[key];

const wrapper = ({ children }: { children: ReactNode }) => (
  <SettingsProvider>{children}</SettingsProvider>
);

/** Mounts the screen over a developer-options-on blob with `alpha` selected. */
const mount = (props?: { onClose?: () => void; reload?: () => void }) => {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ developerOptions: true, modelIds: ["alpha"] }),
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
  it("offers no save until something is actually different", async () => {
    mount();
    expect(screen.getByTestId("model-save")).toBeDisabled();
    await userEvent.click(screen.getByTestId("model-option-beta"));
    expect(screen.getByTestId("model-save")).toBeEnabled();
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
