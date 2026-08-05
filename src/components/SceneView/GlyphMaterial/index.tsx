import { GLYPH_OPACITY } from "../consts";

/**
 * The material every glyph mesh draws with: flat, unlit, and translucent. The
 * authored opacity rides along in userData.baseOpacity so the scene's fade
 * animator multiplies against it rather than compounding its own last value
 * (see applyFade); a mesh that skips this component drops out of the fades.
 */
export const GlyphMaterial = ({ color }: { color: string }) => (
  <meshBasicMaterial
    color={color}
    transparent
    opacity={GLYPH_OPACITY}
    userData={{ baseOpacity: GLYPH_OPACITY }}
  />
);
