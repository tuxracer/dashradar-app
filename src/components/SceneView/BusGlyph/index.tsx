import { GLASS_COLOR } from "../consts";
import { GlyphBox } from "../GlyphBox";
import { Wheel } from "../Wheel";
import { BUS_COLOR } from "./consts";

export * from "./consts";

/** Axle positions along the bus as fractions of its length. */
const AXLES = [-0.34, 0.3];

/**
 * A bus glyph, sized in meters and built from fractions of that size. A bus
 * really is a slab at this level of abstraction, so the detail that earns its
 * place is the window band: it runs the full length and wraps the ends, which
 * is what separates a bus from a box truck of the same size at a glance.
 */
export const BusGlyph = ({
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
      color={BUS_COLOR}
      center={[0, height * 0.62, 0]}
      size={[width * 0.92, height * 0.76, length]}
    />
    <GlyphBox
      color={GLASS_COLOR}
      center={[0, height * 0.76, 0]}
      size={[width * 0.93, height * 0.28, length * 0.94]}
    />
    {AXLES.flatMap((axle) =>
      [-1, 1].map((side) => (
        <Wheel
          key={`wheel${side}${axle}`}
          center={[side * width * 0.44, height * 0.15, axle * length]}
          diameter={height * 0.3}
          tread={width * 0.12}
        />
      )),
    )}
  </>
);
