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
