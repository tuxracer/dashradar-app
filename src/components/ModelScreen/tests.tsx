import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelScreen } from "@/components/ModelScreen";
import { SettingsProvider, STORAGE_KEY } from "@/context/SettingsContext";
import type { PersistedSettings } from "@/context/SettingsContext";
import {
  addStoredModel,
  DEFAULT_MODEL,
  loadStoredModels,
} from "@/lib/detectionModels";
import type { DetectionModel } from "@/lib/detectionModels";
import type { trialLoadModel } from "@/lib/modelTrialLoad";

/**
 * Stands in for the model the running session pinned at mount. The real
 * provider needs a worker and a camera, and the pin is the only thing this
 * screen reads from it.
 */
vi.mock("@/context/DetectionContext", () => ({
  useDetection: () => ({ activeModel: running, loadedClasses: undefined }),
}));

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

/**
 * Picks a model the way someone does: open its card from the row, then take it.
 * With the confirm accepted that is the whole flow, selection and reload
 * included.
 */
const choose = async (id: string) => {
  await userEvent.click(screen.getByTestId(`model-option-${id}`));
  await userEvent.click(screen.getByTestId("model-card-use"));
};

/** Opens a model's card and removes it from there. */
const removeFromCard = async (id: string) => {
  await userEvent.click(screen.getByTestId(`model-option-${id}`));
  await userEvent.click(screen.getByTestId(`model-remove-${id}`));
};

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
  // There is no staging step to get wrong: the confirm is the decision, and
  // everything after it has already happened by the time the screen is gone.
  it("carries no save button", async () => {
    mount();
    expect(screen.queryByTestId("model-save")).toBeNull();
    await userEvent.click(screen.getByTestId("model-option-beta"));
    expect(screen.queryByTestId("model-save")).toBeNull();
  });

  it("opens a model's card from its row, and comes back to the list", async () => {
    mount();
    await userEvent.click(screen.getByTestId("model-option-beta"));
    expect(screen.getByTestId("model-card-use")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("model-card-back"));
    expect(screen.getByTestId("model-option-beta")).toBeInTheDocument();
    // Opening and closing a card cannot have changed what runs.
    expect(stored("modelIds")).toEqual(["alpha"]);
  });

  it("offers no second take on the model already selected", async () => {
    mount();
    await userEvent.click(screen.getByTestId("model-option-alpha"));
    // Nothing selected would leave no model to load, so the selected model's
    // card cannot deselect it.
    expect(screen.getByTestId("model-card-use")).toBeDisabled();
  });

  it("commits and reloads as soon as a model is taken", async () => {
    const reload = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mount({ reload });
    await choose("beta");
    // Past the cap the oldest pick drops, so this replaces rather than adds.
    expect(stored("modelIds")).toEqual(["beta"]);
    expect(reload).toHaveBeenCalled();
  });

  it("writes nothing and stays put when the confirm is declined", async () => {
    const reload = vi.fn();
    const onClose = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    mount({ reload, onClose });
    await choose("beta");
    expect(stored("modelIds")).toEqual(["alpha"]);
    expect(reload).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // Still on the card, since nothing was applied to go back to.
    expect(screen.getByTestId("model-card-use")).toBeInTheDocument();
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
    await userEvent.click(screen.getByTestId("model-card-use"));
    expect(reload).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalled();
  });

  it("leaves the selection alone on back", async () => {
    const onClose = vi.fn();
    mount({ onClose });
    await userEvent.click(screen.getByTestId("model-back"));
    expect(stored("modelIds")).toEqual(["alpha"]);
    expect(onClose).toHaveBeenCalled();
  });
});

/**
 * Mounts the screen with no `models` prop, so `knownModels()` drives it.
 * `trialLoad` is a test seam (jsdom cannot run a worker); the other props
 * default to no-ops the way the screen's own defaults would behave.
 */
const renderModelScreen = (props?: {
  onClose?: () => void;
  reload?: () => void;
  trialLoad?: typeof trialLoadModel;
}) =>
  render(
    <ModelScreen
      onClose={props?.onClose ?? vi.fn()}
      reload={props?.reload ?? vi.fn()}
      trialLoad={props?.trialLoad}
    />,
    { wrapper },
  );

describe("removing a stored model", () => {
  const addedModel: DetectionModel = {
    id: "https://huggingface.co/someone/some-repo/resolve/abc/model.onnx",
    owner: "someone",
    slug: "some-repo",
    revision: "abc",
    file: "model.onnx",
  };

  beforeEach(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        developerOptions: true,
        modelIds: [DEFAULT_MODEL.id],
      }),
    );
    addStoredModel(addedModel);
    running = DEFAULT_MODEL;
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("offers no remove on the shipping model's card", async () => {
    renderModelScreen();
    await userEvent.click(
      screen.getByTestId(`model-option-${DEFAULT_MODEL.id}`),
    );
    expect(
      screen.queryByTestId(`model-remove-${DEFAULT_MODEL.id}`),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("model-card-back"));
    await userEvent.click(screen.getByTestId(`model-option-${addedModel.id}`));
    expect(
      screen.getByTestId(`model-remove-${addedModel.id}`),
    ).toBeInTheDocument();
  });

  it("removes the row and unregisters the model", async () => {
    renderModelScreen();
    await removeFromCard(addedModel.id);
    // Unregistered at once; the row itself outlives the click only as long as
    // it takes to collapse out of the list.
    expect(loadStoredModels()).toEqual([]);
    await waitFor(() => {
      expect(
        screen.queryByTestId(`model-option-${addedModel.id}`),
      ).not.toBeInTheDocument();
    });
  });

  it("keeps the model when the confirm is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderModelScreen();
    await removeFromCard(addedModel.id);
    // Still on its own card, since a declined confirm changed nothing.
    expect(
      screen.getByTestId(`model-remove-${addedModel.id}`),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("model-card-back"));
    expect(
      screen.getByTestId(`model-option-${addedModel.id}`),
    ).toBeInTheDocument();
    expect(loadStoredModels()).toEqual([addedModel]);
  });

  // The stored id is left dangling by the removal, and an id no build knows
  // resolves to the shipping model, which is also what the next load will run.
  it("marks the shipping model again after removing the selected one", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ modelIds: [addedModel.id] }),
    );
    renderModelScreen();
    // The added model is the one marked, so the removal has a selection to
    // take with it rather than landing on a screen already on the default.
    expect(screen.getByTestId(`model-option-${addedModel.id}`)).toBeTruthy();
    await removeFromCard(addedModel.id);
    // The removed row stays mounted long enough to collapse out, and the mark
    // cannot move while the entry it points at is still in the list.
    await waitFor(() => {
      expect(
        screen.queryByTestId(`model-option-${addedModel.id}`),
      ).not.toBeInTheDocument();
    });
    await userEvent.click(
      screen.getByTestId(`model-option-${DEFAULT_MODEL.id}`),
    );
    expect(screen.getByTestId("model-card-use")).toBeDisabled();
  });
});

describe("adding a model from a URL", () => {
  // A full commit sha, so resolveModelFromUrl resolves it locally without a
  // network call; these tests are about the trial load, not the pinning
  // lookup, which src/lib/detectionModels/tests.ts covers directly.
  const pastedUrl = `https://huggingface.co/someone/some-repo/resolve/${"a".repeat(40)}/model.onnx`;

  const openAndSubmit = async (
    trialLoad: typeof trialLoadModel,
    url = pastedUrl,
  ) => {
    renderModelScreen({ trialLoad });
    await userEvent.click(screen.getByTestId("model-add-open"));
    await userEvent.type(screen.getByTestId("model-add-url"), url);
    await userEvent.click(screen.getByTestId("model-add-submit"));
  };

  beforeEach(() => {
    localStorage.clear();
  });

  // The download is the commitment: by the time a trial has proved the file
  // runs, the bytes are cached and the entry is stored, so there is nothing
  // left for a save step to do. Running it is a separate decision, taken from
  // its row like any other model's.
  it("registers a model that passes its trial, without running it", async () => {
    await openAndSubmit(async () => ({
      ok: true,
      loaded: { headWidth: 2, classes: [{ index: 1, label: "police" }] },
    }));
    await waitFor(() => {
      expect(loadStoredModels()).toHaveLength(1);
    });
    const added = loadStoredModels()[0];
    expect(added.id).toBe(pastedUrl);
    expect(stored("modelIds")).toEqual([DEFAULT_MODEL.id]);
    expect(screen.getByTestId(`model-option-${pastedUrl}`)).toBeInTheDocument();
    // The summary names what it detects.
    expect(screen.getByTestId("model-add-status").textContent).toContain(
      "police",
    );
  });

  // A checkpoint does not have to live on Hugging Face. There is no API to ask
  // a strange host anything, so the link has to name the file itself, and the
  // trial load is what proves the bytes behind it run here.
  it("registers a model from a plain link to an onnx file", async () => {
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);
    const url = "https://models.example.com/patrol-v2.onnx";
    await openAndSubmit(
      async () => ({ ok: true, loaded: { headWidth: 2, classes: [] } }),
      url,
    );
    await waitFor(() => {
      expect(loadStoredModels()).toHaveLength(1);
    });
    expect(loadStoredModels()[0]).toMatchObject({
      id: url,
      owner: "models.example.com",
      slug: "patrol-v2",
      weightsUrl: url,
    });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("registers nothing when the trial fails, and shows the reason", async () => {
    await openAndSubmit(async () => ({
      ok: false,
      reason: "input shape mismatch",
    }));
    await waitFor(() => {
      expect(screen.getByTestId("model-add-status").textContent).toContain(
        "input shape mismatch",
      );
    });
    expect(loadStoredModels()).toEqual([]);
  });

  // Off Hugging Face there is nothing to ask what a page holds, so a link that
  // does not name the file is refused before a byte moves rather than
  // downloading whatever is at the other end to find out.
  it("rejects a link that names no onnx file, without running a trial", async () => {
    const trialLoad = vi.fn();
    renderModelScreen({ trialLoad });
    await userEvent.click(screen.getByTestId("model-add-open"));
    await userEvent.type(
      screen.getByTestId("model-add-url"),
      "https://example.com/models/",
    );
    await userEvent.click(screen.getByTestId("model-add-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("model-add-status")).toBeInTheDocument();
    });
    expect(trialLoad).not.toHaveBeenCalled();
    expect(loadStoredModels()).toEqual([]);
  });

  it("starts no trial when the screen unmounts during URL resolution", async () => {
    const trialLoad = vi.fn();
    // A bare repo page (no pinned revision/file) forces resolveModelFromUrl
    // through the Hugging Face lookup instead of resolving locally, so the
    // fetch can be held open past the unmount.
    let settleFetch: ((response: Response) => void) | undefined;
    const fetchStub = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          settleFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchStub);
    const { unmount } = renderModelScreen({ trialLoad });
    await userEvent.click(screen.getByTestId("model-add-open"));
    await userEvent.type(
      screen.getByTestId("model-add-url"),
      "https://huggingface.co/someone/some-repo",
    );
    await userEvent.click(screen.getByTestId("model-add-submit"));
    await waitFor(() => {
      expect(fetchStub).toHaveBeenCalled();
    });

    unmount();
    // The lookup settles only after the screen is gone, naming a single onnx
    // file so resolveModelFromUrl would otherwise succeed and hand a trial
    // load a real candidate.
    settleFetch?.({
      ok: true,
      json: async () => ({
        sha: "deadbeef",
        siblings: [{ rfilename: "model.onnx" }],
      }),
    } as Response);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(trialLoad).not.toHaveBeenCalled();
  });
});

describe("choosing between a repo's onnx files", () => {
  const repoUrl = "https://huggingface.co/someone/some-repo";
  const sha = "b".repeat(40);

  /** Answers every revision lookup with a repo holding two checkpoints. */
  const stubAmbiguousRepo = () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            json: async () => ({
              sha,
              siblings: [
                { rfilename: "onnx/model_fp16.onnx" },
                { rfilename: "README.md" },
                { rfilename: "model.onnx" },
              ],
            }),
          }) as Response,
      ),
    );
  };

  const openAndSubmit = async (trialLoad?: typeof trialLoadModel) => {
    renderModelScreen({ trialLoad });
    await userEvent.click(screen.getByTestId("model-add-open"));
    await userEvent.type(screen.getByTestId("model-add-url"), repoUrl);
    await userEvent.click(screen.getByTestId("model-add-submit"));
  };

  beforeEach(() => {
    localStorage.clear();
    stubAmbiguousRepo();
  });

  it("offers a row per onnx file instead of failing the add", async () => {
    const trialLoad = vi.fn();
    await openAndSubmit(trialLoad);
    await waitFor(() => {
      expect(screen.getByTestId("model-file-model.onnx")).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("model-file-onnx/model_fp16.onnx"),
    ).toBeInTheDocument();
    // Only the checkpoints; the repo's other files are not offered.
    expect(
      screen.queryByTestId("model-file-README.md"),
    ).not.toBeInTheDocument();
    // Nothing is downloaded until a file is picked.
    expect(trialLoad).not.toHaveBeenCalled();
  });

  it("trials and registers the picked file, pinned to the repo's sha", async () => {
    const trialLoad = vi.fn(async () => ({ ok: true }) as const);
    await openAndSubmit(trialLoad);
    await waitFor(() => {
      expect(
        screen.getByTestId("model-file-onnx/model_fp16.onnx"),
      ).toBeInTheDocument();
    });
    await userEvent.click(
      screen.getByTestId("model-file-onnx/model_fp16.onnx"),
    );
    await waitFor(() => {
      expect(loadStoredModels()).toHaveLength(1);
    });
    const added = loadStoredModels()[0];
    expect(added.file).toBe("onnx/model_fp16.onnx");
    expect(added.revision).toBe(sha);
    expect(added.id).toBe(
      `https://huggingface.co/someone/some-repo/resolve/${sha}/onnx/model_fp16.onnx`,
    );
    expect(trialLoad).toHaveBeenCalledWith(
      expect.objectContaining({ file: "onnx/model_fp16.onnx" }),
      expect.anything(),
    );
  });

  it("returns to the pasted URL on cancel, registering nothing", async () => {
    await openAndSubmit(vi.fn());
    await waitFor(() => {
      expect(screen.getByTestId("model-file-cancel")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId("model-file-cancel"));
    expect(screen.getByTestId("model-add-url")).toHaveValue(repoUrl);
    expect(loadStoredModels()).toEqual([]);
  });
});
