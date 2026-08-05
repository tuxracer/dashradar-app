import type { ReactElement } from "react";
import type { PlacedKind } from "@/lib/scenePlacement";
import { BusGlyph } from "../BusGlyph";
import { CarGlyph } from "../CarGlyph";
import { CycleGlyph } from "../CycleGlyph";
import { PersonGlyph } from "../PersonGlyph";
import { TrafficLightGlyph } from "../TrafficLightGlyph";
import { TruckGlyph } from "../TruckGlyph";

/**
 * The glyph for one placed kind, drawn with its base at the group origin so
 * the animator only ever positions the group on the ground plane. Sizes are
 * rough real-world footprints in meters; they are visual vocabulary, not the
 * height priors the placement math uses. The return type is annotated on
 * purpose: it is what makes a newly placed kind a compile error here rather
 * than a glyph that silently renders nothing.
 */
export const SceneGlyph = ({
  kind,
  elevationM,
}: {
  kind: PlacedKind;
  elevationM: number;
}): ReactElement => {
  switch (kind) {
    case "police":
      return <CarGlyph police width={1.9} height={1.6} length={5} />;
    case "car":
      return <CarGlyph width={1.8} height={1.45} length={4.6} />;
    case "truck":
      return <TruckGlyph width={2.1} height={2.5} length={6.5} />;
    case "bus":
      return <BusGlyph width={2.5} height={3.1} length={11} />;
    case "motorcycle":
      return <CycleGlyph motorized width={0.5} height={1.3} length={2.1} />;
    case "bicycle":
      return <CycleGlyph width={0.4} height={1.1} length={1.8} />;
    case "person":
      return <PersonGlyph />;
    case "trafficLight":
      return <TrafficLightGlyph elevationM={elevationM} />;
  }
};
