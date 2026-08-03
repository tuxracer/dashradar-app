import { describe, expect, it } from "vitest";
import {
  classesFromMetadata,
  DEFAULT_MODEL,
  DETECTION_MODELS,
  modelRepoUrl,
  modelWeightsUrl,
  resolveModels,
} from "@/lib/detectionModels";
import type { DetectionModel } from "@/lib/detectionModels";
import type { OnnxMetadata } from "@/lib/onnxMetadata";

/** A registry that does not ship, so multi-model behavior is testable. */
const FAKE_MODELS: readonly DetectionModel[] = [
  { id: "alpha", slug: "alpha-repo", revision: "v1", file: "alpha.onnx" },
  { id: "beta", slug: "beta-repo", revision: "v2", file: "beta.onnx" },
];

/** Metadata carrying a `names` map already stringified into its dialect. */
const stamped = (names: string): OnnxMetadata => ({ props: { names } });

/** Metadata carrying a `names` map in the JSON dialect. */
const named = (names: unknown): OnnxMetadata => stamped(JSON.stringify(names));

describe("resolveModels", () => {
  it("falls back to the first model when no id is known", () => {
    expect(resolveModels(["gone"], FAKE_MODELS)).toEqual([FAKE_MODELS[0]]);
  });

  it("falls back to the first model for an empty selection", () => {
    expect(resolveModels([], FAKE_MODELS)).toEqual([FAKE_MODELS[0]]);
  });

  it("keeps only the ids the registry knows", () => {
    expect(resolveModels(["beta", "gone"], FAKE_MODELS)).toEqual([
      FAKE_MODELS[1],
    ]);
  });

  it("collapses a repeated id to one entry", () => {
    expect(resolveModels(["beta", "beta"], FAKE_MODELS)).toEqual([
      FAKE_MODELS[1],
    ]);
  });

  it("returns entries in registry order, not selection order", () => {
    expect(resolveModels(["beta", "alpha"], FAKE_MODELS)).toEqual([
      FAKE_MODELS[0],
      FAKE_MODELS[1],
    ]);
  });

  it("resolves against the shipping registry by default", () => {
    expect(resolveModels([DEFAULT_MODEL.id])).toEqual([DEFAULT_MODEL]);
  });
});

describe("model urls", () => {
  it("pins the revision and file the entry names", () => {
    expect(modelWeightsUrl(FAKE_MODELS[1])).toBe(
      "https://huggingface.co/tuxracer/beta-repo/resolve/v2/onnx/beta.onnx",
    );
  });

  it("points the repo url at the entry's slug", () => {
    expect(modelRepoUrl(FAKE_MODELS[0])).toBe(
      "https://huggingface.co/tuxracer/alpha-repo",
    );
  });
});

describe("the shipping registry", () => {
  it("never pins a mutable ref", () => {
    for (const model of DETECTION_MODELS) {
      expect(model.revision).not.toBe("main");
    }
  });

  it("gives every model a unique id", () => {
    const ids = DETECTION_MODELS.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("classesFromMetadata", () => {
  it("reads the label and the logit index off the stamped names map", () => {
    expect(classesFromMetadata(named({ 1: "police" }), 2)).toEqual([
      { index: 1, label: "police" },
    ]);
  });

  it("reads the Python dialect an Ultralytics export writes", () => {
    // `str()` on the dict, so bare integer keys and single quotes. This is what
    // the great majority of ONNX detectors in the wild carry, and it is not JSON.
    const classes = classesFromMetadata(
      stamped("{0: 'person', 1: 'bicycle', 2: 'car'}"),
      3,
    );

    expect(classes).toEqual([
      { index: 1, label: "bicycle" },
      { index: 2, label: "car" },
    ]);
  });

  it("reads a label whose apostrophe forced the other quote style", () => {
    // Python emits {0: "don't"} rather than escaping, so both quote styles turn
    // up in one map.
    const classes = classesFromMetadata(
      stamped("{1: \"don't walk\", 2: 'walk'}"),
      3,
    );

    expect(classes.map((entry) => entry.label)).toEqual(["don't walk", "walk"]);
  });

  it("drops slots the loaded head cannot hold", () => {
    const classes = classesFromMetadata(
      named({ 0: "background", 1: "police", 5: "beyond the head" }),
      2,
    );

    expect(classes.map((entry) => entry.label)).toEqual(["police"]);
  });

  it("names every slot generically when the file names nothing", () => {
    expect(classesFromMetadata(undefined, 3)).toEqual([
      { index: 1, label: "class-1" },
      { index: 2, label: "class-2" },
    ]);
  });

  it("falls back the same way for a names map it cannot read", () => {
    const cases: (OnnxMetadata | undefined)[] = [
      { props: {} },
      { props: { names: "not a map at all" } },
      { props: { names: "[1, 2]" } },
      // A map, but not of index to label: a class table cannot be either of
      // these, so reading them as one would invent classes.
      stamped("{1: 7}"),
      stamped("{'police': 1}"),
      stamped("{1: 'police'"),
      named({ 1: "" }),
    ];

    for (const metadata of cases) {
      expect(classesFromMetadata(metadata, 2)).toEqual([
        { index: 1, label: "class-1" },
      ]);
    }
  });
});
