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

/** Metadata carrying whatever `names` map a case needs. */
const named = (names: unknown): OnnxMetadata => ({
  props: { names: JSON.stringify(names) },
});

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
      { index: 1, label: "police", displayLabel: "POLICE" },
    ]);
  });

  it("opens separators up for the display label", () => {
    const [entry] = classesFromMetadata(named({ 1: "fire_truck" }), 2);

    expect(entry.displayLabel).toBe("FIRE TRUCK");
    expect(entry.label).toBe("fire_truck");
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
      { index: 1, label: "class-1", displayLabel: "CLASS 1" },
      { index: 2, label: "class-2", displayLabel: "CLASS 2" },
    ]);
  });

  it("falls back the same way for a names map it cannot read", () => {
    const cases: (OnnxMetadata | undefined)[] = [
      { props: {} },
      { props: { names: "not json" } },
      { props: { names: "[1, 2]" } },
      named({ 1: 7 }),
      named({ 1: "" }),
    ];

    for (const metadata of cases) {
      expect(classesFromMetadata(metadata, 2)).toEqual([
        { index: 1, label: "class-1", displayLabel: "CLASS 1" },
      ]);
    }
  });
});
