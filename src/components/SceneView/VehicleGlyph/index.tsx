import { UNIT_CYLINDER } from "../consts";
import { GlyphBox } from "../GlyphBox";
import { GlyphMaterial } from "../GlyphMaterial";
import {
  POLICE_LIGHTBAR_COLOR,
  VEHICLE_COLORS,
  VEHICLE_GLASS_COLOR,
  VEHICLE_TIRE_COLOR,
} from "./consts";
import type { VehicleKind } from "./types";

export * from "./consts";
export * from "./types";

/**
 * Kinds drawn as a car rather than a plain box. A truck or a bus really is a
 * box at this level of abstraction, and the two-wheelers are too small on
 * screen to hold any of the detail below, so only these two earn it.
 */
const CAR_LIKE: readonly VehicleKind[] = ["police", "car"];

/** Wheel corners as (side, end) signs: left or right, by front or rear. */
const WHEEL_CORNERS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

/**
 * A vehicle glyph, sized in meters and built from fractions of that size so
 * one description covers every kind. Cars get the shape that actually reads as
 * a car from the chase camera: a hull with a narrower greenhouse set back on
 * it, a window band around the greenhouse, and four wheels standing slightly
 * proud of the body. Everything else is a single box, and police add a roof
 * lightbar.
 */
export const VehicleGlyph = ({
  kind,
  width,
  height,
  length,
}: {
  kind: VehicleKind;
  width: number;
  height: number;
  length: number;
}) => {
  const color = VEHICLE_COLORS[kind];

  if (!CAR_LIKE.includes(kind)) {
    return (
      <GlyphBox
        color={color}
        center={[0, height / 2, 0]}
        size={[width, height, length]}
      />
    );
  }

  // Wheels are cylinders lying on their side: three scales a cylinder along
  // its own axes before rotating it, so the diameter is x and z and the tread
  // width is y. The hull is narrower than the stated width so the wheels can
  // define it; hiding them inside the body is what made this read as a crate.
  const wheelDiameter = height * 0.52;

  return (
    <>
      <GlyphBox
        color={color}
        center={[0, height * 0.44, 0]}
        size={[width * 0.88, height * 0.56, length]}
      />
      <GlyphBox
        color={color}
        center={[0, height * 0.86, length * 0.06]}
        size={[width * 0.74, height * 0.28, length * 0.46]}
      />
      <GlyphBox
        color={VEHICLE_GLASS_COLOR}
        center={[0, height * 0.885, length * 0.06]}
        size={[width * 0.75, height * 0.15, length * 0.47]}
      />
      {WHEEL_CORNERS.map(([side, end]) => (
        <mesh
          key={`wheel${side}${end}`}
          geometry={UNIT_CYLINDER}
          position={[side * width * 0.44, height * 0.26, end * length * 0.31]}
          rotation={[0, 0, Math.PI / 2]}
          scale={[wheelDiameter, width * 0.12, wheelDiameter]}
        >
          <GlyphMaterial color={VEHICLE_TIRE_COLOR} />
        </mesh>
      ))}
      {kind === "police" && (
        <GlyphBox
          color={POLICE_LIGHTBAR_COLOR}
          center={[0, height + 0.09, length * 0.06]}
          size={[width * 0.46, 0.18, 0.3]}
        />
      )}
    </>
  );
};
