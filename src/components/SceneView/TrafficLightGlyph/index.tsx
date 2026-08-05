import { UNIT_SPHERE } from "../consts";
import { GlyphBox } from "../GlyphBox";
import { GlyphMaterial } from "../GlyphMaterial";
import {
  TRAFFIC_LIGHT_HOUSING_COLOR,
  TRAFFIC_LIGHT_LAMP_COLORS,
} from "./consts";

export * from "./consts";

/**
 * A traffic-light glyph: the signal head alone, floating at its mounted
 * height with no pole (deliberate; the head is the recognizable part), a
 * dark housing with the red, amber, and green lamps facing the ego.
 */
export const TrafficLightGlyph = ({ elevationM }: { elevationM: number }) => (
  <>
    <GlyphBox
      color={TRAFFIC_LIGHT_HOUSING_COLOR}
      center={[0, elevationM + 0.55, 0]}
      size={[0.44, 1.05, 0.3]}
    />
    {TRAFFIC_LIGHT_LAMP_COLORS.map((color, index) => (
      <mesh
        key={color}
        geometry={UNIT_SPHERE}
        position={[0, elevationM + 0.55 + (1 - index) * 0.32, 0.17]}
        scale={[0.24, 0.24, 0.12]}
      >
        <GlyphMaterial color={color} />
      </mesh>
    ))}
  </>
);
