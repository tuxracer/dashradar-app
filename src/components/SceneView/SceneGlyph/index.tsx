import type { PlacedKind } from "@/lib/scenePlacement";
import { PersonGlyph } from "../PersonGlyph";
import { TrafficLightGlyph } from "../TrafficLightGlyph";
import { VehicleGlyph } from "../VehicleGlyph";

/**
 * The glyph for one placed kind, drawn with its base at the group origin so
 * the animator only ever positions the group on the ground plane. Sizes are
 * rough real-world footprints in meters; they are visual vocabulary, not the
 * height priors the placement math uses.
 */
export const SceneGlyph = ({
  kind,
  elevationM,
}: {
  kind: PlacedKind;
  elevationM: number;
}) => {
  switch (kind) {
    case "police":
      return <VehicleGlyph kind={kind} width={1.9} height={1.6} length={5} />;
    case "car":
      return (
        <VehicleGlyph kind={kind} width={1.8} height={1.45} length={4.6} />
      );
    case "truck":
      return <VehicleGlyph kind={kind} width={2.1} height={2.5} length={6.5} />;
    case "bus":
      return <VehicleGlyph kind={kind} width={2.5} height={3.1} length={11} />;
    case "motorcycle":
      return <VehicleGlyph kind={kind} width={0.5} height={1.3} length={2.1} />;
    case "bicycle":
      return <VehicleGlyph kind={kind} width={0.4} height={1.1} length={1.8} />;
    case "person":
      return <PersonGlyph />;
    case "trafficLight":
      return <TrafficLightGlyph elevationM={elevationM} />;
  }
};
