/** Length of one full ambient-plus-detection loop in ms. */
export const BEAT_LOOP_MS = 9_000;

/** Loop time at which the police contact enters the scene. */
export const CONTACT_APPEAR_MS = 5_000;

/** Loop time at which the contact has passed and despawns. */
export const CONTACT_EXIT_MS = 8_400;

/** Loop time rendered as the single static reduced-motion frame. */
export const STATIC_FRAME_MS = 3_000;

/** Pixel-ratio cap so 3x phones do not paint 9x the pixels. */
export const DPR_CAP = 2;

/** Brand amber as "r,g,b" for rgba() composition. */
export const AMBER_RGB = "255,179,64";

/** Cool white-blue of the police contact's body glow. */
export const CONTACT_BODY_RGB = "180,190,220";

/** Warm white of the oncoming headlights and their streak trails. */
export const HEADLIGHT_RGB = "255,235,200";

/** Red of the receding taillights. */
export const TAILLIGHT_RGB = "255,62,48";

/** Red half of the contact's alternating light bar. */
export const LIGHT_BAR_RED_RGB = "255,40,40";

/** Blue half of the contact's alternating light bar. */
export const LIGHT_BAR_BLUE_RGB = "70,110,255";

/** Light-bar red/blue alternation period in ms. */
export const STROBE_INTERVAL_MS = 130;

/** Duration of the amber ripple fired as the lock snaps on, in ms. */
export const RIPPLE_MS = 700;

/** Half the wireframe grid's width in road units. */
export const GRID_HALF_WIDTH = 9;

/** Spacing between the fixed lines converging on the vanishing point. */
export const LONGITUDINAL_SPACING = 1.5;

/** Spacing between the cross lines scrolling toward the camera. */
export const CROSS_SPACING = 2.4;

/** How many cross lines cycle through the visible depth range. */
export const CROSS_LINE_COUNT = 26;

/** Cross-line scroll speed toward the camera, road units per second. */
export const GRID_SCROLL_SPEED = 9;

/** Depth beyond which grid lines are no longer drawn. */
export const GRID_FAR_Z = 60;

/** Base alpha of the amber grid lines. */
export const GRID_ALPHA = 0.34;

/** Depth at which traffic blips respawn and fade out entirely. */
export const TRAFFIC_FAR_Z = 55;

/** Receding traffic blips shrinking toward the horizon. */
export const RECEDING_CAR_COUNT = 4;

/** Receding blip speed away from the camera, road units per second. */
export const RECEDING_SPEED = 6.5;

/** Depth a receding blip respawns at after fading out far ahead. */
export const RECEDING_RESET_Z = 3;

/** Oncoming traffic blips streaking toward the camera. */
export const ONCOMING_CAR_COUNT = 3;

/** Oncoming blip speed toward the camera, road units per second. */
export const ONCOMING_SPEED = 16;

/** Depth of the motion trail dragged behind each traffic light. */
export const TRAFFIC_TRAIL_Z = 2.2;

/** Ambient bokeh glows drifting in the sky band. */
export const BOKEH_COUNT = 16;

/** Fraction of the frame height the bokeh field occupies from the top. */
export const BOKEH_SKY_FRAC = 0.5;

/**
 * Focal length is based on the frame width in portrait (min of the two takes
 * over) so the road does not blow out in a tall narrow frame.
 */
export const FOCAL_WIDTH_FACTOR = 1.55;

/** Scale applied to the focal basis dimension. */
export const FOCAL_SCALE = 1.15;

/** Camera height factor dropping ground points below the horizon. */
export const GROUND_DROP_FACTOR = 1.15;

/**
 * Per-orientation projection and detection-beat tuning, taken from the
 * approved intro mocks (landscape from intro-mocks.html variant C, portrait
 * from intro-mocks-portrait-v2.html variant C).
 */
export type SceneTuning = {
  /** Horizon height as a fraction of the frame height. */
  horizonFrac: number;
  /** Lateral road position the police contact rides (the right shoulder). */
  shoulderX: number;
  /** Nearest depth at which grid lines and oncoming blips are drawn. */
  nearZ: number;
  /** Contact depth at spawn. */
  contactSpawnZ: number;
  /** Contact depth as it passes out of frame. */
  contactPassZ: number;
  /** Far edge of the depth window in which the lock-on bracket engages. */
  lockFarZ: number;
  /** Near edge of the lock window. */
  lockNearZ: number;
  /** Lock-snap ripple max radius as a fraction of the frame width. */
  rippleWidthFrac: number;
  /** Alternating lateral lanes for receding taillight pairs. */
  recedingLanes: readonly [number, number];
  /** Alternating lateral lanes for oncoming headlight pairs. */
  oncomingLanes: readonly [number, number];
  /** Half the distance between a receding car's two taillights. */
  recedingPairOffset: number;
  /** Half the distance between an oncoming car's two headlights. */
  oncomingPairOffset: number;
};

/** Portrait tuning: shallower beat and tighter lanes for a narrow frame. */
export const PORTRAIT_TUNING: SceneTuning = {
  horizonFrac: 0.34,
  shoulderX: 1.8,
  nearZ: 1.6,
  contactSpawnZ: 30,
  contactPassZ: 4.5,
  lockFarZ: 24,
  lockNearZ: 4.2,
  rippleWidthFrac: 0.45,
  recedingLanes: [0.95, 1.7],
  oncomingLanes: [-1.3, -1.9],
  recedingPairOffset: 0.34,
  oncomingPairOffset: 0.3,
};

/** Landscape tuning: deeper beat and wider lanes for a wide frame. */
export const LANDSCAPE_TUNING: SceneTuning = {
  horizonFrac: 0.4,
  shoulderX: 3.2,
  nearZ: 1.9,
  contactSpawnZ: 34,
  contactPassZ: 3.5,
  lockFarZ: 26,
  lockNearZ: 4.5,
  rippleWidthFrac: 0.3,
  recedingLanes: [1.15, 2.0],
  oncomingLanes: [-1.5, -2.2],
  recedingPairOffset: 0.4,
  oncomingPairOffset: 0.35,
};
