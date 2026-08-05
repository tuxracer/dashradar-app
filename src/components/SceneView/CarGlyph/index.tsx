import { GLASS_COLOR } from "../consts";
import { GlyphBox } from "../GlyphBox";
import { Wheel } from "../Wheel";
import {
  CAR_COLOR,
  POLICE_COLOR,
  POLICE_LIGHTBAR_COLOR,
  TAILLIGHT_COLOR,
} from "./consts";

export * from "./consts";

/** Wheel corners as (side, end) signs: left or right, by front or rear. */
const WHEEL_CORNERS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

/**
 * A car glyph, sized in meters and built from fractions of that size. The
 * shape that reads as a car rather than a crate: a hull with a narrower
 * greenhouse set back on it, a window band around the greenhouse, and four
 * wheels. The hull is narrower than the stated width so the wheels define it;
 * tucking them inside the body hides them completely at any real range.
 * Police add a roof lightbar and take the alert color.
 */
export const CarGlyph = ({
  police,
  width,
  height,
  length,
}: {
  police?: boolean;
  width: number;
  height: number;
  length: number;
}) => {
  const color = police ? POLICE_COLOR : CAR_COLOR;

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
        color={GLASS_COLOR}
        center={[0, height * 0.885, length * 0.06]}
        size={[width * 0.75, height * 0.15, length * 0.47]}
      />
      {WHEEL_CORNERS.map(([side, end]) => (
        <Wheel
          key={`wheel${side}${end}`}
          center={[side * width * 0.44, height * 0.26, end * length * 0.31]}
          diameter={height * 0.52}
          tread={width * 0.12}
        />
      ))}
      {[-1, 1].map((side) => (
        <GlyphBox
          key={`tail${side}`}
          color={TAILLIGHT_COLOR}
          center={[side * width * 0.29, height * 0.5, length * 0.5]}
          size={[width * 0.22, height * 0.09, 0.06]}
        />
      ))}
      {police && (
        <GlyphBox
          color={POLICE_LIGHTBAR_COLOR}
          center={[0, height + 0.09, length * 0.06]}
          size={[width * 0.46, 0.18, 0.3]}
        />
      )}
    </>
  );
};
