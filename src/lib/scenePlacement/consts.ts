import type { HeightPrior } from "./types";

/** Lowest horizontal field of view the scene view accepts, in degrees. */
export const SCENE_FOV_DEG_MIN = 50;

/** Highest horizontal field of view the scene view accepts, in degrees. */
export const SCENE_FOV_DEG_MAX = 90;

/**
 * Default full-frame horizontal field of view in degrees: a typical phone
 * main camera held in landscape.
 */
export const SCENE_FOV_DEG_DEFAULT = 68;

/** Nearest depth a placement may take, in meters along the camera axis. */
export const MIN_PLACEMENT_M = 2;

/** Farthest depth a placement may take, in meters along the camera axis. */
export const MAX_PLACEMENT_M = 150;

/**
 * Height priors in match order: the first entry any of whose terms appears in
 * the lowercased label wins. Ordering is load-bearing. Police terms come
 * before car so "police car" resolves to police, and car sits last because
 * its terms are the broadest and would otherwise swallow more specific kinds.
 */
export const HEIGHT_PRIORS: readonly HeightPrior[] = [
  {
    kind: "police",
    terms: ["police", "sheriff", "patrol", "trooper", "interceptor", "cruiser"],
    heightM: 1.85,
    elevationM: 0,
  },
  {
    kind: "bus",
    terms: ["bus"],
    heightM: 3.1,
    elevationM: 0,
  },
  {
    // Worst prior of the set: the class spans pickups to semis.
    kind: "truck",
    terms: ["truck", "lorry", "pickup", "semi"],
    heightM: 2.5,
    elevationM: 0,
  },
  {
    kind: "motorcycle",
    terms: ["motorcycle", "motorbike", "scooter"],
    heightM: 1.3,
    elevationM: 0,
  },
  {
    kind: "bicycle",
    terms: ["bicycle", "bike"],
    heightM: 1.1,
    elevationM: 0,
  },
  {
    kind: "person",
    terms: ["person", "pedestrian", "cyclist"],
    heightM: 1.7,
    elevationM: 0,
  },
  {
    kind: "trafficLight",
    terms: ["traffic light", "traffic-light", "traffic signal", "stoplight"],
    heightM: 1.05,
    elevationM: 4.5,
  },
  {
    // 1.55 splits sedans and SUVs since the class mixes both.
    kind: "car",
    terms: ["car", "sedan", "suv", "van", "taxi", "vehicle"],
    heightM: 1.55,
    elevationM: 0,
  },
];
