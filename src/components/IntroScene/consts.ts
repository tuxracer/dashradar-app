/**
 * Device pixel ratio cap for the scene canvas. The scene is a soft, glowy
 * background, so rendering above 1.5x wastes GPU on pixels nobody can see,
 * and this screen shows while the model download already has the radios busy.
 */
export const MAX_SCENE_DPR = 1.5;

/**
 * Scene time (seconds) of the single frame drawn under
 * prefers-reduced-motion. Chosen so the scan wave sits mid-sweep and the
 * frame reads as a complete composition rather than an empty road.
 */
export const STATIC_FRAME_TIME_S = 12.5;
