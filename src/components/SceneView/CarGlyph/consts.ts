/**
 * Police body color: near-black, the dark half of the black-and-white livery
 * every patrol car in this app's training set wears. Kept clear of a true
 * black for the same reason as the tires, so the body does not sink into the
 * backdrop and leave the white panels floating.
 */
export const POLICE_BODY_COLOR = "#34323f";

/**
 * The white half of the police livery: doors, hood, roof, and the rear panel.
 * Off-white rather than pure white so it still separates from the ground under
 * the light scene palette, which is white.
 */
export const POLICE_PANEL_COLOR = "#e6e3f0";

/**
 * Civilian car body color, dim so other traffic shapes the scene without
 * competing with the police lightbar.
 */
export const CAR_COLOR = "#8a8794";

/**
 * Red half of the roof lightbar. The police glyph carries no alert color on
 * its body any more, so this is what makes the class the app exists for read
 * as the alert at a glance.
 */
export const POLICE_LIGHTBAR_RED = "#ff3b30";

/**
 * Blue half of the roof lightbar. Bright and slightly cyan-shifted so it holds
 * against a dark ground, where a deep blue would read as another black panel.
 */
export const POLICE_LIGHTBAR_BLUE = "#2f6bff";

/**
 * The red half between flashes. Dark enough to read as an unlit lens, but
 * still recognizably red, so a glyph too far away to resolve the strobe still
 * shows a red-and-blue bar rather than a bar with one end missing.
 */
export const POLICE_LIGHTBAR_RED_DIM = "#6b201b";

/** The blue half between flashes (see POLICE_LIGHTBAR_RED_DIM). */
export const POLICE_LIGHTBAR_BLUE_DIM = "#1b2f6b";

/**
 * Opacity of the halo drawn over the lit half of the bar. Additive over the
 * car's own dark roof, which is what sells it as light coming off the lamp
 * rather than a bigger lamp.
 */
export const LIGHTBAR_GLOW_OPACITY = 0.5;

/**
 * Opacity of the pool of light on the road under a flashing car. Normally
 * blended rather than additive: additive over the white ground of the light
 * scene palette adds nothing, and a patrol car that stops throwing light when
 * the phone switches to its day appearance would be the one glyph in the
 * scene that changes meaning with the OS.
 */
export const LIGHTBAR_POOL_OPACITY = 0.34;

/**
 * Taillight color. Cars are drawn facing away, which makes the tail the one
 * end a driver ever sees, so it is the only lamp worth spending a mesh on.
 */
export const TAILLIGHT_COLOR = "#d8332c";
