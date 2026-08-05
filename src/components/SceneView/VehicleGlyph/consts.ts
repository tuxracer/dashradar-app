import type { VehicleKind } from "./types";

/**
 * Body color per vehicle kind. Police takes the meter's full-signal red so the
 * class the app exists for is the one that reads as the alert; riders take the
 * amber accent, which they share with the person glyph; other traffic stays
 * dim so it shapes the scene without competing.
 */
export const VEHICLE_COLORS: Record<VehicleKind, string> = {
  police: "#ff5a3c",
  car: "#8a8794",
  truck: "#8a8794",
  bus: "#8a8794",
  bicycle: "#ffb340",
  motorcycle: "#ffb340",
};

/** Roof lightbar color on the police glyph: near-white, so it reads as a lamp. */
export const POLICE_LIGHTBAR_COLOR = "#f2effa";

/**
 * Tire color, shared by every body color. Dark enough to separate the wheels
 * from the body, but deliberately well clear of the backdrop: a true black
 * would sink into it and leave the hull looking like it floats.
 */
export const VEHICLE_TIRE_COLOR = "#3b3946";

/**
 * Glass color for the window band around the greenhouse. Always drawn against
 * a body color rather than the backdrop, so it can go darker than the tires.
 */
export const VEHICLE_GLASS_COLOR = "#23222c";
