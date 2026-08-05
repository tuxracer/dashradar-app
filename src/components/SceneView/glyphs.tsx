import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  SphereGeometry,
} from "three";
import type { PlacedKind } from "@/lib/scenePlacement";
import {
  EGO_COLOR,
  GLYPH_OPACITY,
  KIND_COLORS,
  TRAFFIC_LIGHT_HOUSING_COLOR,
  TRAFFIC_LIGHT_LAMP_COLORS,
} from "./consts";

/**
 * Shared unit geometries, scaled per mesh. Three of them cover every glyph,
 * so the whole scene uploads a handful of vertex buffers once at module load
 * regardless of how many objects are on the ground plane. Deliberately
 * low-poly: the placement math is good to tens of percent in range, and a
 * detailed car model would claim a precision the data does not have.
 */
const UNIT_BOX = new BoxGeometry(1, 1, 1);
const UNIT_CYLINDER = new CylinderGeometry(0.5, 0.5, 1, 10);
const UNIT_SPHERE = new SphereGeometry(0.5, 10, 8);
const UNIT_PYRAMID = new ConeGeometry(0.5, 1, 4);

/** One box of a glyph: position and scale in meters, sharing UNIT_BOX. */
const GlyphBox = ({
  color,
  center,
  size,
}: {
  color: string;
  center: readonly [number, number, number];
  size: readonly [number, number, number];
}) => (
  <mesh
    geometry={UNIT_BOX}
    position={[center[0], center[1], center[2]]}
    scale={[size[0], size[1], size[2]]}
  >
    <meshBasicMaterial
      color={color}
      transparent
      opacity={GLYPH_OPACITY}
      userData={{ baseOpacity: GLYPH_OPACITY }}
    />
  </mesh>
);

/** A vehicle glyph: one body box, and for police a lightbar on the roof. */
const VehicleGlyph = ({
  kind,
  width,
  height,
  length,
}: {
  kind: PlacedKind;
  width: number;
  height: number;
  length: number;
}) => (
  <>
    <GlyphBox
      color={KIND_COLORS[kind]}
      center={[0, height / 2, 0]}
      size={[width, height, length]}
    />
    {kind === "police" && (
      <GlyphBox
        color="#f2effa"
        center={[0, height + 0.12, 0]}
        size={[width * 0.6, 0.22, 0.4]}
      />
    )}
  </>
);

/** A person glyph: torso cylinder and head sphere. */
const PersonGlyph = () => (
  <>
    <mesh
      geometry={UNIT_CYLINDER}
      position={[0, 0.6, 0]}
      scale={[0.45, 1.2, 0.45]}
    >
      <meshBasicMaterial
        color={KIND_COLORS.person}
        transparent
        opacity={GLYPH_OPACITY}
        userData={{ baseOpacity: GLYPH_OPACITY }}
      />
    </mesh>
    <mesh
      geometry={UNIT_SPHERE}
      position={[0, 1.42, 0]}
      scale={[0.44, 0.44, 0.44]}
    >
      <meshBasicMaterial
        color={KIND_COLORS.person}
        transparent
        opacity={GLYPH_OPACITY}
        userData={{ baseOpacity: GLYPH_OPACITY }}
      />
    </mesh>
  </>
);

/**
 * A traffic-light glyph: the signal head alone, floating at its mounted
 * height with no pole (deliberate; the head is the recognizable part), a
 * dark housing with the red, amber, and green lamps facing the ego.
 */
const TrafficLightGlyph = ({ elevationM }: { elevationM: number }) => (
  <>
    <GlyphBox
      color={TRAFFIC_LIGHT_HOUSING_COLOR}
      center={[0, elevationM + 0.55, 0]}
      size={[0.44, 1.05, 0.3]}
    />
    {TRAFFIC_LIGHT_LAMP_COLORS.map((color, index) => (
      <mesh
        key={color}
        geometry={UNIT_SPHERE}
        position={[0, elevationM + 0.55 + (1 - index) * 0.32, 0.17]}
        scale={[0.24, 0.24, 0.12]}
      >
        <meshBasicMaterial
          color={color}
          transparent
          opacity={GLYPH_OPACITY}
          userData={{ baseOpacity: GLYPH_OPACITY }}
        />
      </mesh>
    ))}
  </>
);

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

/**
 * The ego marker: a flat four-sided pyramid at the origin pointing ahead
 * (negative z), standing in for the phone's own car.
 */
export const EgoMarker = () => (
  <mesh
    geometry={UNIT_PYRAMID}
    position={[0, 0.12, 0]}
    rotation={[-Math.PI / 2, 0, 0]}
    scale={[1.1, 2, 0.24]}
  >
    <meshBasicMaterial
      color={EGO_COLOR}
      transparent
      opacity={GLYPH_OPACITY}
      userData={{ baseOpacity: GLYPH_OPACITY }}
    />
  </mesh>
);
