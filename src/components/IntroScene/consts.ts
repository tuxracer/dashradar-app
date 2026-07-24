/** Length of one full ambient-plus-detection loop in ms. */
export const BEAT_LOOP_MS = 9_000;

/** Loop time at which the police contact enters the scene. */
export const CONTACT_APPEAR_MS = 5_000;

/** Loop time at which the contact has passed and despawns. */
export const CONTACT_EXIT_MS = 8_400;

/** Contact depth at spawn (three.js world units; camera looks down -Z). */
export const CONTACT_SPAWN_Z = -70;

/** Contact depth as it passes out of frame. */
export const CONTACT_PASS_Z = -3;

/**
 * Contact lane offset per unit of camera aspect ratio. Scaling the lane by
 * aspect pins the bracket to the same upper-right screen region in portrait
 * and landscape, clear of the centered copy column.
 */
export const CONTACT_LANE_X_PER_ASPECT = 15.5;

/** Far edge of the depth window in which the lock-on bracket engages. */
export const LOCK_FAR_Z = -46;

/**
 * Near edge of the lock window. The lock releases here, while the bracket is
 * still riding the sky band above the copy and before the wide lane carries
 * the contact off the right edge of the frame.
 */
export const LOCK_NEAR_Z = -30;

/** Scene clear color, matching the app's near-black surface. */
export const SCENE_BACKGROUND = 0x05060a;

/** Brand amber shared by the grid and blips. */
export const AMBER = 0xffb340;

/** Exponential fog density swallowing the far grid. */
export const FOG_DENSITY = 0.028;

/** Half the grid's width in world units. */
export const GRID_HALF_WIDTH = 26;

/** How far the grid extends away from the camera in world units. */
export const GRID_DEPTH = 130;

/** Distance between cross-grid lines in world units. */
export const GRID_SPACING = 2.4;

/** How fast the cross-grid scrolls toward the camera, units per second. */
export const GRID_SCROLL_SPEED = 9;

/** Ambient traffic blip count. */
export const BLIP_COUNT = 7;

/** Pixel-ratio cap so 3x phones do not render 9x the pixels. */
export const DPR_CAP = 1.75;

/** Loop time rendered as the single static reduced-motion frame. */
export const STATIC_FRAME_MS = 3_000;
