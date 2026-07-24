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

/** Lane offset keeping the contact clear of the centered copy. */
export const CONTACT_LANE_X = 2.6;

/** Far edge of the depth window in which the lock-on bracket engages. */
export const LOCK_FAR_Z = -46;

/** Near edge of the depth window in which the lock-on bracket engages. */
export const LOCK_NEAR_Z = -6;

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
