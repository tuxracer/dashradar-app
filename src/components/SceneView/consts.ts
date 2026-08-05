import { BoxGeometry, CylinderGeometry, SphereGeometry } from "three";
import type { PlacedKind, ScenePlacement } from "@/lib/scenePlacement";

/**
 * Shared unit geometries, scaled per mesh. Three of them cover every glyph,
 * so the whole scene uploads a handful of vertex buffers once at module load
 * regardless of how many objects are on the ground plane. Deliberately
 * low-poly: the placement math is good to tens of percent in range, and a
 * detailed car model would claim a precision the data does not have.
 */
export const UNIT_BOX = new BoxGeometry(1, 1, 1);

/** Shared unit cylinder, scaled per mesh (see UNIT_BOX). */
export const UNIT_CYLINDER = new CylinderGeometry(0.5, 0.5, 1, 10);

/** Shared unit sphere, scaled per mesh (see UNIT_BOX). */
export const UNIT_SPHERE = new SphereGeometry(0.5, 10, 8);

/** Builds one sample placement for TEST_PLACEMENTS below. */
const test = (
  id: number,
  kind: PlacedKind,
  xM: number,
  zM: number,
  elevationM = 0,
): ScenePlacement => ({
  id,
  kind,
  label: kind,
  score: 1,
  xM,
  zM,
  elevationM,
  rangeM: Math.hypot(xM, zM),
  bearingRad: Math.atan2(xM, zM),
});

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

/** Scene backdrop and fog color (the app surface color). */
export const SURFACE_COLOR = "#0b0a10";

/** Grid line color, a dim amber matching the radar backdrop's grid. */
export const GRID_COLOR = "#8a6a33";

/** Roof lightbar color on the police glyph: near-white, so it reads as a lamp. */
export const POLICE_LIGHTBAR_COLOR = "#f2effa";

/** Traffic-light housing color: dark, so the lamps carry the glyph. */
export const TRAFFIC_LIGHT_HOUSING_COLOR = "#2f2d38";

/**
 * Traffic-light lamp colors, top to bottom: the meter's full-signal red, the
 * amber accent, and the meter's low-signal green.
 */
export const TRAFFIC_LIGHT_LAMP_COLORS: readonly [string, string, string] = [
  "#ff5a3c",
  "#ffb340",
  "#4ade40",
];

/**
 * Glyph color per placed kind. Police takes the meter's full-signal red so
 * the class the app exists for is the one that reads as the alert; people
 * and riders take the amber accent; other traffic stays dim so it shapes the
 * scene without competing. The trafficLight entry keeps the record total,
 * but its glyph is drawn from the housing and lamp colors above instead.
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

/**
 * The sample placements the Scene test objects developer option renders: one
 * of every placed kind at a known position, spread across bearing and range so
 * glyph rendering, placement geometry, and the FoV calibration can all be
 * judged on a device without live detections. Negative ids so they can never
 * collide with real track ids.
 */
export const TEST_PLACEMENTS: readonly ScenePlacement[] = [
  test(-1, "police", -4, 20),
  test(-2, "car", 3, 35),
  test(-3, "truck", -8, 60),
  test(-4, "bus", 10, 90),
  test(-5, "person", 2, 12),
  test(-6, "bicycle", -2.5, 16),
  test(-7, "motorcycle", 5.5, 26),
  test(-8, "trafficLight", 0, 30, 4.5),
];
