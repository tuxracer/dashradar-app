import type { PlacedKind } from "@/lib/scenePlacement";

/**
 * Chase-camera position in scene meters: slightly above and behind the ego
 * marker, like the view following the player's car in a driving game. Ahead
 * of the ego is negative z (the three.js convention a default camera looks
 * down), so the camera sits at positive z looking toward CAMERA_TARGET.
 */
export const CHASE_CAMERA_POSITION: readonly [number, number, number] = [
  0, 9, 14,
];

/** Point the chase camera looks at, in scene meters ahead of the ego. */
export const CAMERA_TARGET: readonly [number, number, number] = [0, 0, -28];

/** Vertical field of view of the chase camera, in degrees. */
export const CHASE_CAMERA_FOV = 50;

/** Near clip plane of the chase camera, in meters. */
export const CAMERA_NEAR_M = 0.5;

/** Far clip plane of the chase camera, in meters. */
export const CAMERA_FAR_M = 400;

/**
 * Fog band in meters: full color at the near edge, fully surface-colored at
 * the far edge. Distance falloff is the one depth cue basic materials cannot
 * give on their own, and fading into the backdrop keeps the far clip and the
 * grid edge from reading as hard lines.
 */
export const FOG_NEAR_M = 60;

/** Far edge of the fog band, in meters (see FOG_NEAR_M). */
export const FOG_FAR_M = 260;

/** Side length of the square ground grid, in meters. */
export const GRID_SIZE_M = 300;

/** Grid line count per side; GRID_SIZE_M / GRID_DIVISIONS is one square. */
export const GRID_DIVISIONS = 30;

/** Grid center in scene meters, pushed ahead so most of it is in view. */
export const GRID_CENTER: readonly [number, number, number] = [0, 0, -100];

/** Opacity of the ground grid lines. */
export const GRID_OPACITY = 0.14;

/**
 * How long a glyph glides from its previous fix to a new one, in ms. Well
 * inside the 1 s scan floor, so a tween always finishes before the next
 * result can land and the invalidation loop is guaranteed to park between
 * scans.
 */
export const TWEEN_MS = 400;

/** Fade-in duration for a newly tracked glyph, in ms. */
export const FADE_IN_MS = 250;

/** Fade-out duration for a glyph whose track has died, in ms. */
export const FADE_OUT_MS = 300;

/**
 * Device-pixel-ratio ceiling for the canvas. A 3x phone display would
 * otherwise rasterize nine times the pixels of a 1x one for glyphs this
 * simple, and fill rate is GPU time the thermal budget would rather spend on
 * inference.
 */
export const DPR_MAX = 1.5;

/**
 * How long a lost WebGL context may stay lost before the recovery ladder
 * escalates (first to a canvas remount, then to the render-failure callback).
 */
export const CONTEXT_RESTORE_TIMEOUT_MS = 4_000;

/** Scene color of the ego marker and glyph accents (the HUD amber). */
export const EGO_COLOR = "#ffb340";

/** Scene backdrop and fog color (the app surface color). */
export const SURFACE_COLOR = "#0b0a10";

/** Grid line color, a dim amber matching the radar backdrop's grid. */
export const GRID_COLOR = "#8a6a33";

/**
 * Glyph color per placed kind. Police takes the meter's full-signal red so
 * the class the app exists for is the one that reads as the alert; people
 * and riders take the amber accent; other traffic stays dim so it shapes the
 * scene without competing; traffic lights take the meter's low-signal green.
 */
export const KIND_COLORS: Record<PlacedKind, string> = {
  police: "#ff5a3c",
  car: "#8a8794",
  truck: "#8a8794",
  bus: "#8a8794",
  person: "#ffb340",
  bicycle: "#ffb340",
  motorcycle: "#ffb340",
  trafficLight: "#4ade40",
};

/** Base opacity of glyph bodies (fades multiply against it). */
export const GLYPH_OPACITY = 0.92;
