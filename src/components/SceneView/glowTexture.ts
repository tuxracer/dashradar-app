import { CanvasTexture } from "three";
import { GLOW_TEXTURE_PX } from "./consts";

let texture: CanvasTexture | undefined;

let built = false;

/**
 * Draws the falloff once into an offscreen canvas: opaque at the center,
 * transparent at the rim, on a curve steep enough that the square edge of the
 * canvas is fully clear long before it is reached.
 */
const build = (): CanvasTexture | undefined => {
  const canvas = document.createElement("canvas");
  canvas.width = GLOW_TEXTURE_PX;
  canvas.height = GLOW_TEXTURE_PX;
  const context = canvas.getContext("2d");
  if (!context) {
    return undefined;
  }
  const half = GLOW_TEXTURE_PX / 2;
  const gradient = context.createRadialGradient(
    half,
    half,
    0,
    half,
    half,
    half,
  );
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.55)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, GLOW_TEXTURE_PX, GLOW_TEXTURE_PX);
  return new CanvasTexture(canvas);
};

/**
 * A soft round falloff, white so a material tints it to whatever color the
 * lamp is showing. Shared by every glow in the scene and built on first use
 * rather than at import, which keeps a canvas out of the jsdom test path;
 * where a 2D context cannot be had, callers get undefined and skip the glow
 * rather than drawing a hard-edged rectangle of light.
 */
export const glowFalloff = (): CanvasTexture | undefined => {
  if (!built) {
    built = true;
    texture = build();
  }
  return texture;
};
