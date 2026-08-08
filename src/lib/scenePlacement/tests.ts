import { describe, expect, it } from "vitest";
import type { Size } from "@/lib/detection";
import type { Track } from "@/lib/detectionTracker";
import {
  focalLengthPx,
  HEIGHT_PRIORS,
  matchPlacedKind,
  MAX_PLACEMENT_M,
  MIN_PLACEMENT_M,
  placeTrack,
  placeTracks,
  SCENE_FOV_DEG_DEFAULT,
} from "@/lib/scenePlacement";

/** A police track whose box is centered and 100 px tall in the test frame. */
const track = (overrides: Partial<Track> = {}): Track => ({
  id: "track-1",
  color: "#00ff00",
  label: "police",
  score: 0.9,
  box: { xmin: 0.45, ymin: 0.4, xmax: 0.55, ymax: 0.5 },
  lastSeenAt: 0,
  ...overrides,
});

/** Native video size used by most placement tests. */
const frame: Size = { width: 2_000, height: 1_000 };

/** Focal length used by most placement tests, in pixels. */
const F_PX = 1_000;

describe("focalLengthPx", () => {
  it("gives half the frame width at a 90 degree field of view", () => {
    expect(focalLengthPx(90, 1_024)).toBeCloseTo(512);
  });
});

describe("matchPlacedKind", () => {
  it("matches case-insensitively", () => {
    expect(matchPlacedKind("POLICE")).toBe("police");
  });

  it("resolves 'police car' to police, not car", () => {
    expect(matchPlacedKind("police car")).toBe("police");
  });

  it("returns undefined for labels no prior knows", () => {
    expect(matchPlacedKind("dog")).toBeUndefined();
    expect(matchPlacedKind("")).toBeUndefined();
  });

  it("places the normalized vehicle class with the car glyph", () => {
    // "car" and "truck" surface as "vehicle" upstream, so this term is what
    // keeps folded vehicles on the scene at all.
    expect(matchPlacedKind("vehicle")).toBe("car");
  });
});

describe("placeTrack", () => {
  it("places a known triangle: 1.85 m object, 100 px tall, fPx 1000, at 18.5 m", () => {
    const placement = placeTrack(track(), frame, F_PX);
    expect(placement?.zM).toBeCloseTo(18.5);
  });

  it("places a centered box on the axis with zero bearing", () => {
    const placement = placeTrack(track(), frame, F_PX);
    expect(placement?.xM).toBeCloseTo(0);
    expect(placement?.bearingRad).toBeCloseTo(0);
  });

  it("places a box right of center at positive xM and bearing", () => {
    const placement = placeTrack(
      track({ box: { xmin: 0.6, ymin: 0.4, xmax: 0.7, ymax: 0.5 } }),
      frame,
      F_PX,
    );
    expect(placement?.xM).toBeGreaterThan(0);
    expect(placement?.bearingRad).toBeGreaterThan(0);
  });

  it("is zoom independent: the same normalized box places at the same depth", () => {
    const smallFrame: Size = { width: 1_024, height: 576 };
    const largeFrame: Size = { width: 2_048, height: 1_152 };
    const small = placeTrack(
      track(),
      smallFrame,
      focalLengthPx(SCENE_FOV_DEG_DEFAULT, smallFrame.width),
    );
    const large = placeTrack(
      track(),
      largeFrame,
      focalLengthPx(SCENE_FOV_DEG_DEFAULT, largeFrame.width),
    );
    expect(small?.zM).toBeCloseTo(large?.zM ?? Number.NaN);
  });

  it("clamps a 1 px box to the far placement bound", () => {
    const placement = placeTrack(
      track({ box: { xmin: 0.45, ymin: 0.4995, xmax: 0.55, ymax: 0.5005 } }),
      frame,
      F_PX,
    );
    expect(placement?.zM).toBe(MAX_PLACEMENT_M);
  });

  it("clamps an enormous box to the near placement bound", () => {
    const placement = placeTrack(
      track({ box: { xmin: 0.1, ymin: 0, xmax: 0.9, ymax: 1 } }),
      frame,
      F_PX,
    );
    expect(placement?.zM).toBe(MIN_PLACEMENT_M);
  });

  it("drops labels no prior knows", () => {
    expect(placeTrack(track({ label: "dog" }), frame, F_PX)).toBeUndefined();
    expect(placeTrack(track({ label: "" }), frame, F_PX)).toBeUndefined();
  });

  it("carries the traffic light prior's elevation", () => {
    const prior = HEIGHT_PRIORS.find((entry) => entry.kind === "trafficLight");
    const placement = placeTrack(
      track({ label: "traffic light" }),
      frame,
      F_PX,
    );
    expect(placement?.elevationM).toBe(prior?.elevationM);
    expect(placement?.elevationM).toBeGreaterThan(0);
  });

  it("places road objects at ground elevation", () => {
    const placement = placeTrack(track(), frame, F_PX);
    expect(placement?.elevationM).toBe(0);
  });

  it("drops a degenerate box with no height", () => {
    const placement = placeTrack(
      track({ box: { xmin: 0.45, ymin: 0.5, xmax: 0.55, ymax: 0.5 } }),
      frame,
      F_PX,
    );
    expect(placement).toBeUndefined();
  });

  it("drops a box with a non-finite coordinate", () => {
    const placement = placeTrack(
      track({ box: { xmin: Number.NaN, ymin: 0.4, xmax: 0.55, ymax: 0.5 } }),
      frame,
      F_PX,
    );
    expect(placement).toBeUndefined();
  });

  it("reports rangeM as the hypotenuse of xM and zM, longer than zM off axis", () => {
    const placement = placeTrack(
      track({ box: { xmin: 0.8, ymin: 0.4, xmax: 0.9, ymax: 0.5 } }),
      frame,
      F_PX,
    );
    expect(placement).toBeDefined();
    if (!placement) {
      return;
    }
    expect(placement.rangeM).toBeCloseTo(
      Math.hypot(placement.xM, placement.zM),
    );
    expect(placement.rangeM).toBeGreaterThan(placement.zM);
  });
});

describe("placeTracks", () => {
  it("derives the focal length from the field of view and drops unknown labels", () => {
    const tracks = [track(), track({ id: "track-2", label: "dog" })];
    const placements = placeTracks({
      tracks,
      frame,
      fovDeg: SCENE_FOV_DEG_DEFAULT,
    });
    expect(placements).toHaveLength(1);
    expect(placements[0].id).toBe("track-1");
    expect(placements[0].zM).toBeCloseTo(
      placeTrack(
        track(),
        frame,
        focalLengthPx(SCENE_FOV_DEG_DEFAULT, frame.width),
      )?.zM ?? Number.NaN,
    );
  });
});
