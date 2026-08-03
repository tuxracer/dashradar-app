import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL,
  DETECTION_MODELS,
  modelRepoUrl,
  modelWeightsUrl,
  resolveModels,
} from "@/lib/detectionModels";
import type { DetectionModel } from "@/lib/detectionModels";

/** A registry that does not ship, so multi-model behavior is testable. */
const FAKE_MODELS: readonly DetectionModel[] = [
  {
    id: "alpha",
    slug: "alpha-repo",
    revision: "v1",
    file: "alpha.onnx",
    headWidth: 2,
    classes: [{ index: 1, label: "a", displayLabel: "A", category: "vehicle" }],
  },
  {
    id: "beta",
    slug: "beta-repo",
    revision: "v2",
    file: "beta.onnx",
    headWidth: 2,
    classes: [{ index: 1, label: "b", displayLabel: "B", category: "person" }],
  },
];

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

  it("never repeats a class index within a model", () => {
    for (const model of DETECTION_MODELS) {
      const indices = model.classes.map((entry) => entry.index);
      expect(new Set(indices).size).toBe(indices.length);
    }
  });

  it("gives every model at least one class to detect", () => {
    for (const model of DETECTION_MODELS) {
      expect(model.classes.length).toBeGreaterThan(0);
    }
  });

  it("points every class at a real logit in its model's head", () => {
    for (const model of DETECTION_MODELS) {
      for (const entry of model.classes) {
        expect(Number.isInteger(entry.index)).toBe(true);
        expect(entry.index).toBeGreaterThanOrEqual(1);
        // Only an entry that declares a width can be checked against one here.
        // The worker checks every entry against the width its session actually
        // reported, declared or not (resolveLoadedModel).
        if (model.headWidth !== undefined) {
          expect(entry.index).toBeLessThan(model.headWidth);
        }
      }
    }
  });

  it("never repeats a class label within a model", () => {
    // enrichDetections joins a raw detection back to its class on the label, so
    // a repeated label hands every box of that class the first entry's display
    // label and category.
    for (const model of DETECTION_MODELS) {
      const labels = model.classes.map((entry) => entry.label);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });
});
