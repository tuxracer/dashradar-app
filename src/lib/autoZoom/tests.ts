import { describe, expect, it } from "vitest";
import type { Detection, NormalizedBox } from "@/types";
import { ZOOM_2X, ZOOM_OFF } from "@/workers/detection/consts";
import { initialAutoZoomState, stepAutoZoom } from "./index";
import type { AutoZoomFrame } from "./types";

const box = (
  xmin: number,
  ymin: number,
  xmax: number,
  ymax: number,
): NormalizedBox => ({ xmin, ymin, xmax, ymax });

const detection = (b: NormalizedBox): Detection => ({
  label: "police",
  displayLabel: "POLICE",
  category: "vehicle",
  score: 0.8,
  box: b,
});

/**
 * A square frame keeps the fit geometry easy to reason about: the 2x region
 * spans 0.25..0.75 on both axes, inset to 0.3..0.7 by the 10% margin.
 */
const frame = (partial: Partial<AutoZoomFrame>): AutoZoomFrame => ({
  zoom: ZOOM_OFF,
  detections: [],
  frameWidth: 1_000,
  frameHeight: 1_000,
  ...partial,
});

describe("initialAutoZoomState", () => {
  it("starts zoomed out and unlocked", () => {
    expect(initialAutoZoomState()).toEqual({ zoom: ZOOM_OFF, locked: false });
  });
});

describe("stepAutoZoom", () => {
  it("alternates between 1x and 2x while nothing is detected", () => {
    const afterEmpty1x = stepAutoZoom(frame({ zoom: ZOOM_OFF }));
    expect(afterEmpty1x).toEqual({ zoom: ZOOM_2X, locked: false });

    const afterEmpty2x = stepAutoZoom(frame({ zoom: ZOOM_2X }));
    expect(afterEmpty2x).toEqual({ zoom: ZOOM_OFF, locked: false });
  });

  it("locks at 2x while a detection is present in the 2x view", () => {
    const next = stepAutoZoom(
      frame({
        zoom: ZOOM_2X,
        detections: [detection(box(0.4, 0.4, 0.6, 0.6))],
      }),
    );
    expect(next).toEqual({ zoom: ZOOM_2X, locked: true });
  });

  it("zooms in when a 1x detection fits inside the inset 2x region", () => {
    const next = stepAutoZoom(
      frame({
        zoom: ZOOM_OFF,
        detections: [detection(box(0.45, 0.45, 0.55, 0.55))],
      }),
    );
    expect(next).toEqual({ zoom: ZOOM_2X, locked: false });
  });

  it("locks at 1x when zooming in would crop the detection", () => {
    const next = stepAutoZoom(
      frame({
        zoom: ZOOM_OFF,
        detections: [detection(box(0.1, 0.4, 0.5, 0.6))],
      }),
    );
    expect(next).toEqual({ zoom: ZOOM_OFF, locked: true });
  });

  it("treats the safety margin as part of the fit check", () => {
    // Inside the raw 2x region (0.25..0.75) but crossing the 10% inset
    // (0.3..0.7): still too close to the crop edge to zoom in on.
    const next = stepAutoZoom(
      frame({
        zoom: ZOOM_OFF,
        detections: [detection(box(0.26, 0.45, 0.5, 0.55))],
      }),
    );
    expect(next).toEqual({ zoom: ZOOM_OFF, locked: true });
  });

  it("stays at 1x unless every detection fits the 2x region", () => {
    const next = stepAutoZoom(
      frame({
        zoom: ZOOM_OFF,
        detections: [
          detection(box(0.45, 0.45, 0.55, 0.55)),
          detection(box(0.6, 0.4, 0.9, 0.6)),
        ],
      }),
    );
    expect(next).toEqual({ zoom: ZOOM_OFF, locked: true });
  });

  it("zooms out first after losing a 2x lock", () => {
    const locked = stepAutoZoom(
      frame({
        zoom: ZOOM_2X,
        detections: [detection(box(0.4, 0.4, 0.6, 0.6))],
      }),
    );
    expect(locked).toEqual({ zoom: ZOOM_2X, locked: true });

    const released = stepAutoZoom(frame({ zoom: locked.zoom }));
    expect(released).toEqual({ zoom: ZOOM_OFF, locked: false });
  });

  it("accounts for aspect ratio in the fit check", () => {
    // 1024x768 frame: the 2x region is a 384px square at (320, 192), so the
    // inset region normalizes to 0.35..0.65 in x but 0.3..0.7 in y. A box at
    // x 0.31..0.5 fits the y band but starts left of the x band.
    const wide = frame({
      zoom: ZOOM_OFF,
      frameWidth: 1_024,
      frameHeight: 768,
    });
    const tooFarLeft = stepAutoZoom({
      ...wide,
      detections: [detection(box(0.31, 0.45, 0.5, 0.55))],
    });
    expect(tooFarLeft).toEqual({ zoom: ZOOM_OFF, locked: true });

    const centered = stepAutoZoom({
      ...wide,
      detections: [detection(box(0.4, 0.45, 0.6, 0.55))],
    });
    expect(centered).toEqual({ zoom: ZOOM_2X, locked: false });
  });
});
