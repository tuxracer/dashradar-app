import { GLASS_COLOR } from "../consts";
import { GlyphBox } from "../GlyphBox";
import { Wheel } from "../Wheel";
import { TRUCK_COLOR } from "./consts";

export * from "./consts";

/**
 * Axle positions along the truck as fractions of its length: one at the front
 * under the cab, then a rear pair, which is the count that says "truck"
 * without drawing a specific one.
 */
const AXLES = [-0.34, 0.2, 0.32];

/**
 * A truck glyph, sized in meters: a cab ahead of a taller cargo box on six
 * wheels. The step down from box to cab is the whole read; without it this is the
 * same blank slab as a bus.
 */
export const TruckGlyph = ({
  width,
  height,
  length,
}: {
  width: number;
  height: number;
  length: number;
}) => (
  <>
    <GlyphBox
      color={TRUCK_COLOR}
      center={[0, height * 0.24, 0]}
      size={[width * 0.7, height * 0.12, length * 0.92]}
    />
    <GlyphBox
      color={TRUCK_COLOR}
      center={[0, height * 0.65, length * 0.19]}
      size={[width * 0.9, height * 0.7, length * 0.6]}
    />
    <GlyphBox
      color={TRUCK_COLOR}
      center={[0, height * 0.53, -length * 0.3]}
      size={[width * 0.86, height * 0.54, length * 0.38]}
    />
    <GlyphBox
      color={GLASS_COLOR}
      center={[0, height * 0.7, -length * 0.3]}
      size={[width * 0.87, height * 0.18, length * 0.39]}
    />
    {AXLES.flatMap((axle) =>
      [-1, 1].map((side) => (
        <Wheel
          key={`wheel${side}${axle}`}
          center={[side * width * 0.44, height * 0.18, axle * length]}
          diameter={height * 0.36}
          tread={width * 0.14}
        />
      )),
    )}
  </>
);
