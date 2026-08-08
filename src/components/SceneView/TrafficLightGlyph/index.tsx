import { UNIT_SPHERE } from "../consts";
import { GlyphBox } from "../GlyphBox";
import { GlyphMaterial } from "../GlyphMaterial";
import {
  TRAFFIC_LIGHT_HOUSING_COLOR,
  TRAFFIC_LIGHT_LAMP_COLORS,
} from "./consts";

export * from "./consts";

/**
 * A traffic-light glyph: the signal head alone at its mounted height, no pole,
 * three visored lamps facing the ego. All three stay lit because nothing here
 * knows the signal's state, and dimming two would invent one.
 */
export const TrafficLightGlyph = ({ elevationM }: { elevationM: number }) => (
  <>
    <GlyphBox
      color={TRAFFIC_LIGHT_HOUSING_COLOR}
      center={[0, elevationM + 0.55, 0]}
      size={[0.44, 1.05, 0.3]}
    />
    {TRAFFIC_LIGHT_LAMP_COLORS.map((color, index) => {
      const lampY = elevationM + 0.55 + (1 - index) * 0.32;
      return (
        <group key={color}>
          <mesh
            geometry={UNIT_SPHERE}
            position={[0, lampY, 0.17]}
            scale={[0.24, 0.24, 0.12]}
          >
            <GlyphMaterial color={color} />
          </mesh>
          <GlyphBox
            color={TRAFFIC_LIGHT_HOUSING_COLOR}
            center={[0, lampY + 0.15, 0.22]}
            size={[0.34, 0.05, 0.18]}
          />
        </group>
      );
    })}
  </>
);
