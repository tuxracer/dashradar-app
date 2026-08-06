import { GLASS_COLOR } from "../consts";
import { GlyphBox } from "../GlyphBox";
import { Wheel } from "../Wheel";
import {
  CAR_COLOR,
  POLICE_BODY_COLOR,
  POLICE_LIGHTBAR_BLUE,
  POLICE_LIGHTBAR_RED,
  POLICE_PANEL_COLOR,
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
 *
 * Police get the black-and-white livery and a red-and-blue roof lightbar,
 * which is what a driver recognizes a patrol car by long before they can read
 * anything written on it. The white panels go where the chase camera actually
 * looks: the doors, the roof, and the tail. The hood is white too, which only
 * shows when a glyph is off to the side, and costs one box to be right there.
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
  const color = police ? POLICE_BODY_COLOR : CAR_COLOR;

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
        <>
          {[-1, 1].map((side) => (
            <GlyphBox
              key={`door${side}`}
              color={POLICE_PANEL_COLOR}
              center={[side * width * 0.44, height * 0.5, length * 0.02]}
              size={[width * 0.03, height * 0.28, length * 0.44]}
            />
          ))}
          <GlyphBox
            color={POLICE_PANEL_COLOR}
            center={[0, height * 0.72, -length * 0.3]}
            size={[width * 0.72, 0.03, length * 0.28]}
          />
          <GlyphBox
            color={POLICE_PANEL_COLOR}
            center={[0, height * 1.0, length * 0.06]}
            size={[width * 0.7, 0.03, length * 0.44]}
          />
          <GlyphBox
            color={POLICE_PANEL_COLOR}
            center={[0, height * 0.35, length * 0.5]}
            size={[width * 0.34, height * 0.16, 0.05]}
          />
          <GlyphBox
            color={POLICE_BODY_COLOR}
            center={[0, height + 0.04, length * 0.06]}
            size={[width * 0.66, 0.07, 0.3]}
          />
          {[-1, 1].map((side) => (
            <GlyphBox
              key={`lightbar${side}`}
              color={side < 0 ? POLICE_LIGHTBAR_RED : POLICE_LIGHTBAR_BLUE}
              center={[side * width * 0.155, height + 0.15, length * 0.06]}
              size={[width * 0.31, 0.15, 0.28]}
            />
          ))}
        </>
      )}
    </>
  );
};
