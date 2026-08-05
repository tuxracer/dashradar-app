import { UNIT_CYLINDER, UNIT_SPHERE, UNIT_TAPERED_CYLINDER } from "../consts";
import { GlyphMaterial } from "../GlyphMaterial";
import { PERSON_COLOR } from "./consts";

export * from "./consts";

/** Signs for the limb pairs, so left and right stay one description. */
const SIDES = [-1, 1];

/**
 * A person glyph, shaped to read as a body rather than a bollard: two legs
 * with daylight between them, a torso tapering from shoulders to waist, arms
 * hanging just clear of it, and a head on a pinched neck. Roughly 1.75 m tall,
 * which is what makes it scale believably against the vehicles beside it.
 * Parts overlap at their joints on purpose, since a butt joint between two
 * translucent meshes reads as a seam.
 */
export const PersonGlyph = () => (
  <>
    {SIDES.map((side) => (
      <mesh
        key={`leg${side}`}
        geometry={UNIT_CYLINDER}
        position={[side * 0.13, 0.45, 0]}
        scale={[0.19, 0.9, 0.19]}
      >
        <GlyphMaterial color={PERSON_COLOR} />
      </mesh>
    ))}
    <mesh
      geometry={UNIT_TAPERED_CYLINDER}
      position={[0, 1.15, 0]}
      scale={[0.42, 0.66, 0.28]}
    >
      <GlyphMaterial color={PERSON_COLOR} />
    </mesh>
    {SIDES.map((side) => (
      <mesh
        key={`arm${side}`}
        geometry={UNIT_CYLINDER}
        position={[side * 0.215, 1.12, 0]}
        rotation={[0, 0, side * 0.06]}
        scale={[0.14, 0.62, 0.14]}
      >
        <GlyphMaterial color={PERSON_COLOR} />
      </mesh>
    ))}
    <mesh
      geometry={UNIT_SPHERE}
      position={[0, 1.63, 0]}
      scale={[0.28, 0.32, 0.28]}
    >
      <GlyphMaterial color={PERSON_COLOR} />
    </mesh>
  </>
);
