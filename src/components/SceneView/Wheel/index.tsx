import { TIRE_COLOR, UNIT_CYLINDER } from "../consts";
import { GlyphMaterial } from "../GlyphMaterial";

/**
 * One road wheel, centered on its axle. three scales a mesh along its own axes
 * before rotating, so the diameter is the x and z scale and the tread width is y.
 * Shared by every vehicle glyph, which keeps them reading as the same part.
 */
export const Wheel = ({
  center,
  diameter,
  tread,
}: {
  center: readonly [number, number, number];
  diameter: number;
  tread: number;
}) => (
  <mesh
    geometry={UNIT_CYLINDER}
    position={[center[0], center[1], center[2]]}
    rotation={[0, 0, Math.PI / 2]}
    scale={[diameter, tread, diameter]}
  >
    <GlyphMaterial color={TIRE_COLOR} />
  </mesh>
);
