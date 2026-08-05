import { TIRE_COLOR, UNIT_CYLINDER } from "../consts";
import { GlyphMaterial } from "../GlyphMaterial";

/**
 * One road wheel, centered on its own axle. A cylinder laid on its side:
 * three scales a mesh along its own axes before rotating it, so the diameter
 * is the x and z scale while the tread width is y. Every vehicle glyph builds
 * its wheels from this, which is what keeps them reading as the same part
 * across kinds that share nothing else.
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
