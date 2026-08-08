import { describe, expect, it, vi } from "vitest";
import { processDetectionResult } from "@/lib/processDetectionResult";
import { SIGNAL_FLOOR } from "@/lib/radarSignal";
import type { Detection, RawDetection } from "@/types";

/** Fake bitmap; the function only carries or discards it, never draws it. */
const bitmap = () => ({ close: vi.fn() }) as unknown as ImageBitmap;

/** Pass-through identity fake: each detection keeps its index as its id. */
const identity = (detections: Detection[]) => {
  const identified = detections.map((detection, index) => ({
    ...detection,
    id: `det-${index}`,
    color: `color-${index}`,
  }));
  return {
    detections: identified,
    tracks: identified.map((detection) => ({
      ...detection,
      lastSeenAt: 0,
      velocity: { centerX: 0, centerY: 0, width: 0, height: 0 },
    })),
  };
};

const police = (
  score: number,
  box = { xmin: 0.15, ymin: 0.4, xmax: 0.25, ymax: 0.6 },
): RawDetection => ({ label: "police", score, box });

describe("processDetectionResult", () => {
  it("filters detections below the threshold and builds the HUD from the tracked set", () => {
    const result = processDetectionResult({
      detections: [police(0.9), police(0.3)],
      crop: undefined,
      confidenceThreshold: 0.5,
      identifyDetections: identity,
      includeContact: true,
      at: 0,
    });
    expect(result.detections).toHaveLength(1);
    expect(result.hud.top?.score).toBe(0.9);
    expect(result.contact).toBeUndefined();
    expect(result.discardedCrop).toBeUndefined();
  });

  it("hands the HUD the tracker's output, not the raw frame's", () => {
    const coasted = identity([police(0.8)]).tracks;
    const result = processDetectionResult({
      detections: [],
      crop: undefined,
      confidenceThreshold: 0.5,
      // A coasting tracker legitimately returns a held track for an empty
      // frame; the HUD must read that, while `detections` stays per-frame.
      identifyDetections: () => ({ detections: [], tracks: coasted }),
      includeContact: true,
      at: 0,
    });
    expect(result.detections).toHaveLength(0);
    expect(result.hud.top?.score).toBe(0.8);
  });

  it("builds a contact from a valid crop, with the remapped signal and heading", () => {
    const midBand = SIGNAL_FLOOR + (1 - SIGNAL_FLOOR) / 2;
    const image = bitmap();
    const result = processDetectionResult({
      detections: [police(midBand)],
      crop: { image, detectionIndex: 0 },
      confidenceThreshold: 0.5,
      identifyDetections: identity,
      includeContact: true,
      at: 42,
    });
    expect(result.contact).toMatchObject({
      image,
      score: midBand,
      direction: "left",
      at: 42,
    });
    // Approximate because midBand is built by dividing the band the floor
    // leaves, so the round trip through the remap lands a few ulps off exact.
    expect(result.contact?.signal).toBeCloseTo(0.5);
    expect(result.discardedCrop).toBeUndefined();
  });

  it("discards a crop of the driver's own hood", () => {
    const image = bitmap();
    const result = processDetectionResult({
      detections: [
        {
          label: "car",
          score: 0.9,
          box: { xmin: 0.05, ymin: 0.7, xmax: 0.95, ymax: 1 },
        },
      ],
      crop: { image, detectionIndex: 0 },
      confidenceThreshold: 0.5,
      scanRegion: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 },
      identifyDetections: identity,
      includeContact: true,
      at: 0,
    });
    expect(result.detections).toHaveLength(0);
    expect(result.contact).toBeUndefined();
    expect(result.discardedCrop).toBe(image);
  });

  it("discards a crop whose detection fails the confidence filter", () => {
    const image = bitmap();
    const result = processDetectionResult({
      detections: [police(0.3)],
      crop: { image, detectionIndex: 0 },
      confidenceThreshold: 0.5,
      identifyDetections: identity,
      includeContact: true,
      at: 0,
    });
    expect(result.contact).toBeUndefined();
    expect(result.discardedCrop).toBe(image);
  });

  it("discards a crop whose index points at no detection", () => {
    const image = bitmap();
    const result = processDetectionResult({
      detections: [police(0.9)],
      crop: { image, detectionIndex: 5 },
      confidenceThreshold: 0.5,
      identifyDetections: identity,
      includeContact: true,
      at: 0,
    });
    expect(result.contact).toBeUndefined();
    expect(result.discardedCrop).toBe(image);
  });

  it("discards a valid crop when no contact is wanted", () => {
    const image = bitmap();
    const result = processDetectionResult({
      detections: [police(0.9)],
      crop: { image, detectionIndex: 0 },
      confidenceThreshold: 0.5,
      identifyDetections: identity,
      includeContact: false,
      at: 0,
    });
    expect(result.contact).toBeUndefined();
    expect(result.discardedCrop).toBe(image);
  });
});
