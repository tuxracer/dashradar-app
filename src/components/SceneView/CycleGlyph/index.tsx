import { GlyphBox } from "../GlyphBox";
import { Wheel } from "../Wheel";
import { CYCLE_COLOR } from "./consts";

export * from "./consts";

/**
 * A bicycle or motorcycle glyph, sized in meters, drawn as one track. The
 * handlebar carries it: these are seen end-on from behind, where the frame is a
 * few centimeters wide and a crossbar is the only thing with width to read.
 * Motorized adds an engine and tank, which is all that separates the two.
 */
export const CycleGlyph = ({
  motorized,
  width,
  height,
  length,
}: {
  motorized?: boolean;
  width: number;
  height: number;
  length: number;
}) => {
  // A road bicycle's wheel is nearly as tall as its frame while a
  // motorcycle's is a fraction of it, so the ratio is doing real work here.
  const wheelDiameter = height * (motorized ? 0.48 : 0.62);

  return (
    <>
      {[-1, 1].map((end) => (
        <Wheel
          key={`wheel${end}`}
          center={[0, wheelDiameter / 2, end * length * 0.34]}
          diameter={wheelDiameter}
          tread={width * 0.4}
        />
      ))}
      <GlyphBox
        color={CYCLE_COLOR}
        center={[0, height * 0.5, 0]}
        size={[
          width * (motorized ? 0.72 : 0.3),
          height * (motorized ? 0.26 : 0.1),
          length * (motorized ? 0.44 : 0.5),
        ]}
      />
      <GlyphBox
        color={CYCLE_COLOR}
        center={[0, height * 0.58, length * 0.14]}
        size={[width * 0.3, height * 0.24, length * 0.1]}
      />
      <GlyphBox
        color={CYCLE_COLOR}
        center={[0, height * 0.7, length * 0.14]}
        size={[width * 0.55, height * 0.08, length * 0.2]}
      />
      <GlyphBox
        color={CYCLE_COLOR}
        center={[0, height * 0.55, -length * 0.3]}
        size={[width * 0.28, height * 0.44, length * 0.09]}
      />
      <GlyphBox
        color={CYCLE_COLOR}
        center={[0, height * 0.72, -length * 0.3]}
        size={[width * (motorized ? 1.3 : 1.5), height * 0.07, length * 0.06]}
      />
    </>
  );
};
