import type { ReactElement } from "react";
import type { PlacedKind } from "@/lib/scenePlacement";
import { BusGlyph } from "../BusGlyph";
import { CarGlyph } from "../CarGlyph";
import { CycleGlyph } from "../CycleGlyph";
import { PersonGlyph } from "../PersonGlyph";
import { TrafficLightGlyph } from "../TrafficLightGlyph";
import { TruckGlyph } from "../TruckGlyph";

/**
 * A vehicle glyph with its near end at the group origin. The placement's depth
 * is to the face the box measured, the end nearest the camera, so the body has
 * to extend away from it: centered on the fix, a car's tail would sit half a
 * length nearer than the detector said.
 */
const NearFaced = ({
  length,
  children,
}: {
  length: number;
  children: ReactElement;
}) => <group position={[0, 0, -length / 2]}>{children}</group>;

/**
 * The glyph for one placed kind, based at the group origin so the animator only
 * ever positions the group. Sizes are visual vocabulary, not the height priors
 * the placement math uses. The annotated return type is what makes a new kind a
 * compile error here rather than a glyph that silently renders nothing.
 */
export const SceneGlyph = ({
  kind,
  color,
  elevationM,
}: {
  kind: PlacedKind;
  /** The object's minted identity color; only the plain car wears it, since
   * every other kind's colors are its silhouette's vocabulary. */
  color?: string;
  elevationM: number;
}): ReactElement => {
  switch (kind) {
    case "police":
      return (
        <NearFaced length={5}>
          <CarGlyph police width={1.9} height={1.6} length={5} />
        </NearFaced>
      );
    case "car":
      return (
        <NearFaced length={4.6}>
          <CarGlyph color={color} width={1.8} height={1.45} length={4.6} />
        </NearFaced>
      );
    case "truck":
      return (
        <NearFaced length={6.5}>
          <TruckGlyph width={2.1} height={2.5} length={6.5} />
        </NearFaced>
      );
    case "bus":
      return (
        <NearFaced length={11}>
          <BusGlyph width={2.5} height={3.1} length={11} />
        </NearFaced>
      );
    case "motorcycle":
      return (
        <NearFaced length={2.1}>
          <CycleGlyph motorized width={0.5} height={1.3} length={2.1} />
        </NearFaced>
      );
    case "bicycle":
      return (
        <NearFaced length={1.8}>
          <CycleGlyph width={0.4} height={1.1} length={1.8} />
        </NearFaced>
      );
    case "person":
      return <PersonGlyph />;
    case "trafficLight":
      return <TrafficLightGlyph elevationM={elevationM} />;
  }
};
