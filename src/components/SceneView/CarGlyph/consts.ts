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
 * Taillight color. Cars are drawn facing away, which makes the tail the one
 * end a driver ever sees, so it is the only lamp worth spending a mesh on.
 */
export const TAILLIGHT_COLOR = "#d8332c";
