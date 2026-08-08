import {
  BoxGeometry,
  CylinderGeometry,
  PlaneGeometry,
  SphereGeometry,
} from "three";

/**
 * Shared unit geometries, scaled per mesh, so the scene uploads a handful of
 * vertex buffers once however many objects are on the ground plane. Low-poly on
 * purpose: a detailed model would claim a precision the placement math lacks.
 */
export const UNIT_BOX = new BoxGeometry(1, 1, 1);

/** Shared unit cylinder, scaled per mesh (see UNIT_BOX). */
export const UNIT_CYLINDER = new CylinderGeometry(0.5, 0.5, 1, 10);

/**
 * A cylinder narrowed toward its base, for the one shape a straight one cannot
 * give the person glyph: shoulders wider than the waist, which is most of what
 * separates a torso from a post at these ranges.
 */
export const UNIT_TAPERED_CYLINDER = new CylinderGeometry(0.5, 0.34, 1, 10);

/** Shared unit sphere, scaled per mesh (see UNIT_BOX). */
export const UNIT_SPHERE = new SphereGeometry(0.5, 10, 8);

/**
 * Shared unit quad, scaled per mesh (see UNIT_BOX). Built in the xy plane, so
 * anything laid on the ground rotates a quarter turn about x.
 */
export const UNIT_PLANE = new PlaneGeometry(1, 1);

/** Side of the shared glow falloff texture, in pixels (see glowFalloff). */
export const GLOW_TEXTURE_PX = 64;

/**
 * Chase-camera position in scene meters, above and behind the ego marker. Ahead
 * is negative z, so the camera sits at positive z looking toward CAMERA_TARGET.
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
 * Fog band in meters: full color at the near edge, surface-colored at the far.
 * The one depth cue basic materials cannot give, and it keeps the far clip and
 * the grid edge from reading as hard lines.
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
 * How long a lightbar holds one color before swapping. The one animation here
 * that does not finish on its own, so it is priced deliberately: one rendered
 * frame per flip, five a second, only while a patrol car is on screen.
 */
export const STROBE_PERIOD_MS = 200;

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

/**
 * Scene colors under a dark scheme, the authored look. Backdrop and fog are one
 * value on purpose: fog that does not fade to exactly what is behind the canvas
 * draws a band across the horizon instead of a distance cue.
 */
export const DARK_SCENE_PALETTE = {
  /** Color behind the canvas, and the color the fog fades to. */
  surface: "#0b0a10",
  /** Ground grid line color. */
  grid: "#8a6a33",
  gridOpacity: 0.14,
};

/**
 * Scene colors under a light scheme, the grid darkened and carried heavier so it
 * sits about as far off white as the dark grid sits off the dark ground.
 */
export const LIGHT_SCENE_PALETTE: typeof DARK_SCENE_PALETTE = {
  surface: "#ffffff",
  grid: "#6f5222",
  gridOpacity: 0.22,
};

/**
 * Tire color, shared by every vehicle glyph. Well clear of the backdrop: a true
 * black would sink into it and leave the bodies looking like they float.
 */
export const TIRE_COLOR = "#3b3946";

/**
 * Window-glass color, shared by every vehicle glyph. Always drawn against a
 * body color rather than the backdrop, so it can go darker than the tires.
 */
export const GLASS_COLOR = "#23222c";

/** Farthest the orientation rig may pan the camera left or right, radians. */
export const RIG_YAW_CLAMP_RAD = 0.35;

/** Farthest the orientation rig may pitch the camera up or down, radians. */
export const RIG_PITCH_CLAMP_RAD = 0.17;

/**
 * Per-event low-pass factor for the rig's camera offset. Orientation sensors
 * report at roughly display rate; this smooths hand shake and road vibration
 * into an eased glide.
 */
export const RIG_SMOOTHING = 0.15;

/**
 * Per-event factor by which the rig's neutral orientation adapts toward the
 * current one. The camera always eases back to center over a few seconds, so
 * a tilted dash mount, a slow turn, or compass drift never holds an offset.
 */
export const RIG_BASELINE_ADAPT = 0.004;

/**
 * Smallest applied-offset change worth a render, radians. Below this the rig
 * neither touches the camera nor invalidates, which is what keeps a vibrating
 * dash mount from re-rendering the scene for the whole drive; the offset must
 * really move to cost a frame.
 */
export const RIG_DEADBAND_RAD = 0.003;
