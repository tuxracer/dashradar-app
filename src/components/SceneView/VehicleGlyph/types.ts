import type { PlacedKind } from "@/lib/scenePlacement";

/**
 * The placed kinds VehicleGlyph draws: everything except the person and
 * traffic-light kinds, which have glyphs of their own. Stated as an exclusion
 * so a newly placed kind lands here and has to be given a color, rather than
 * rendering colorless until someone notices.
 */
export type VehicleKind = Exclude<PlacedKind, "person" | "trafficLight">;
