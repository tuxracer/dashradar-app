import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelCard, UNKNOWN_CLASSES_MESSAGE } from "@/components/ModelCard";
import { DEFAULT_MODEL } from "@/lib/detectionModels";
import type { DetectionClass, DetectionModel } from "@/lib/detectionModels";

/**
 * The card reads what the running session loaded, which needs a worker and a
 * camera to produce for real. Both fields are set per test.
 */
let running: DetectionModel = DEFAULT_MODEL;
let loadedClasses: readonly DetectionClass[] | undefined = undefined;
vi.mock("@/context/DetectionContext", () => ({
  useDetection: () => ({ activeModel: running, loadedClasses }),
}));

/** An added model, whose id is its own pinned weights URL. */
const added: DetectionModel = {
  id: "https://huggingface.co/someone/some-repo/resolve/abc1234/model.onnx",
  owner: "someone",
  slug: "some-repo",
  revision: "a".repeat(40),
  file: "model.onnx",
};

beforeEach(() => {
  running = DEFAULT_MODEL;
  loadedClasses = undefined;
});

const mount = (props?: {
  model?: DetectionModel;
  selected?: boolean;
  onUse?: () => void;
  onRemove?: () => void;
  onBack?: () => void;
}) =>
  render(
    <ModelCard
      model={props?.model ?? added}
      selected={props?.selected ?? false}
      onUse={props?.onUse ?? vi.fn()}
      onRemove={props?.onRemove ?? vi.fn()}
      onBack={props?.onBack ?? vi.fn()}
    />,
  );

describe("ModelCard", () => {
  it("names what the running model looks for, from its own session", () => {
    running = added;
    loadedClasses = [
      { index: 1, label: "police" },
      { index: 2, label: "sheriff" },
    ];
    mount();
    expect(screen.getByText("police, sheriff")).toBeInTheDocument();
  });

  it("names what an added model's trial load saw, without running it", () => {
    mount({
      model: { ...added, classes: [{ index: 1, label: "police" }] },
    });
    expect(screen.getByText("police")).toBeInTheDocument();
  });

  // The alternative is guessing, and a card that names a class the file does
  // not have is worse than one that admits it has not looked.
  it("says so for a model nothing on this device has loaded", () => {
    mount();
    expect(screen.getByText(UNKNOWN_CLASSES_MESSAGE)).toBeInTheDocument();
  });

  // The session's own report wins: the recorded copy was written by a trial
  // load that ran before the file could have been re-exported under a moving
  // revision, which is exactly the case the shipping entry is in.
  it("prefers the live session's classes over the recorded ones", () => {
    running = added;
    loadedClasses = [{ index: 1, label: "police" }];
    mount({ model: { ...added, classes: [{ index: 1, label: "stale" }] } });
    expect(screen.getByText("police")).toBeInTheDocument();
    expect(screen.queryByText("stale")).not.toBeInTheDocument();
  });

  it("links to the model's own page", () => {
    mount();
    expect(screen.getByTestId("model-card-link")).toHaveAttribute(
      "href",
      "https://huggingface.co/someone/some-repo",
    );
  });

  it("abbreviates a commit sha but shows a tag whole", () => {
    mount();
    expect(screen.getByText("aaaaaaa")).toBeInTheDocument();
    mount({ model: { ...added, revision: "v1.0" } });
    expect(screen.getByText("v1.0")).toBeInTheDocument();
  });

  it("offers no remove for the model the build ships", () => {
    mount({ model: DEFAULT_MODEL });
    expect(
      screen.queryByTestId(`model-remove-${DEFAULT_MODEL.id}`),
    ).not.toBeInTheDocument();
  });

  it("takes the model and hands back to the picker", async () => {
    const onUse = vi.fn();
    mount({ onUse });
    await userEvent.click(screen.getByTestId("model-card-use"));
    expect(onUse).toHaveBeenCalled();
  });

  it("cannot take the model twice", () => {
    mount({ selected: true });
    expect(screen.getByTestId("model-card-use")).toBeDisabled();
  });
});
