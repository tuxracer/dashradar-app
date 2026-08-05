import { KIND_COLORS, UNIT_CYLINDER, UNIT_SPHERE } from "../consts";
import { GlyphMaterial } from "../GlyphMaterial";

/** A person glyph: torso cylinder and head sphere. */
export const PersonGlyph = () => (
  <>
    <mesh
      geometry={UNIT_CYLINDER}
      position={[0, 0.6, 0]}
      scale={[0.45, 1.2, 0.45]}
    >
      <GlyphMaterial color={KIND_COLORS.person} />
    </mesh>
    <mesh
      geometry={UNIT_SPHERE}
      position={[0, 1.42, 0]}
      scale={[0.44, 0.44, 0.44]}
    >
      <GlyphMaterial color={KIND_COLORS.person} />
    </mesh>
  </>
);
