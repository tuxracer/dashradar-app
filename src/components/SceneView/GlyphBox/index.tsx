import { UNIT_BOX } from "../consts";
import { GlyphMaterial } from "../GlyphMaterial";

/** One box of a glyph: position and scale in meters, sharing UNIT_BOX. */
export const GlyphBox = ({
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
    <GlyphMaterial color={color} />
  </mesh>
);
