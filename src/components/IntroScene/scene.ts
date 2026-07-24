import {
  AMBER_RGB,
  HEADLIGHT_RGB,
  TAILLIGHT_RGB,
  BEAT_LOOP_MS,
  BOKEH_COUNT,
  BOKEH_SKY_FRAC,
  CONTACT_APPEAR_MS,
  CONTACT_BODY_RGB,
  CONTACT_EXIT_MS,
  CROSS_LINE_COUNT,
  CROSS_SPACING,
  DPR_CAP,
  FOCAL_SCALE,
  FOCAL_WIDTH_FACTOR,
  GRID_ALPHA,
  GRID_FAR_Z,
  GRID_HALF_WIDTH,
  GRID_SCROLL_SPEED,
  GROUND_DROP_FACTOR,
  LANDSCAPE_TUNING,
  LIGHT_BAR_BLUE_RGB,
  LIGHT_BAR_RED_RGB,
  LONGITUDINAL_SPACING,
  ONCOMING_CAR_COUNT,
  ONCOMING_SPEED,
  PORTRAIT_TUNING,
  RECEDING_CAR_COUNT,
  RECEDING_RESET_Z,
  RECEDING_SPEED,
  RIPPLE_MS,
  STROBE_INTERVAL_MS,
  TRAFFIC_FAR_Z,
  TRAFFIC_TRAIL_Z,
} from "./consts";
import type { SceneTuning } from "./consts";

const TAU = Math.PI * 2;

/**
 * Where the police contact is (if anywhere) at a given time within the loop.
 * z is the distance ahead of the camera in road units (smaller is closer).
 */
export type ContactState =
  | { present: false }
  | {
      present: true;
      z: number;
      /** 0 at spawn, 1 as it passes out of frame; drives the fade-in. */
      progress: number;
      lockOn: boolean;
      /** ms since the lock window opened this pass; drives the snap animation. */
      sinceLockMs: number;
    };

/** Pure timeline: contact position and lock status for a loop-relative time. */
export const contactStateAt = (
  loopMs: number,
  tuning: SceneTuning,
): ContactState => {
  const t = ((loopMs % BEAT_LOOP_MS) + BEAT_LOOP_MS) % BEAT_LOOP_MS;
  if (t < CONTACT_APPEAR_MS || t > CONTACT_EXIT_MS) return { present: false };
  const progress =
    (t - CONTACT_APPEAR_MS) / (CONTACT_EXIT_MS - CONTACT_APPEAR_MS);
  const z =
    tuning.contactSpawnZ +
    progress * (tuning.contactPassZ - tuning.contactSpawnZ);
  const lockOn = z < tuning.lockFarZ && z > tuning.lockNearZ;
  const lockProgress =
    (tuning.contactSpawnZ - tuning.lockFarZ) /
    (tuning.contactSpawnZ - tuning.contactPassZ);
  const lockOpensAtMs =
    CONTACT_APPEAR_MS + lockProgress * (CONTACT_EXIT_MS - CONTACT_APPEAR_MS);
  return {
    present: true,
    z,
    progress,
    lockOn,
    sinceLockMs: lockOn ? t - lockOpensAtMs : 0,
  };
};

/** Screen-space contact projection the component positions the bracket with. */
export type ContactProjection = {
  x: number;
  y: number;
  size: number;
  lockOn: boolean;
  sinceLockMs: number;
} | null;

/** Imperative handle the React wrapper drives each animation frame. */
export type IntroSceneHandle = {
  step: (nowMs: number) => ContactProjection;
  resize: (width: number, height: number) => void;
  dispose: () => void;
};

/**
 * Builds the Canvas 2D wireframe night-drive scene: an amber grid highway in
 * one-point perspective, headlight and taillight pairs streaking through it,
 * and the looping detection beat with a red/blue light-bar contact. Returns
 * null when a 2D context is unavailable so the caller can fall back to the
 * static backdrop.
 */
export const createIntroScene = (
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): IntroSceneHandle | null => {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  let frameWidth = width;
  let frameHeight = height;

  const applySize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    canvas.width = Math.max(1, Math.round(frameWidth * dpr));
    canvas.height = Math.max(1, Math.round(frameHeight * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  applySize();

  const activeTuning = (): SceneTuning =>
    frameHeight >= frameWidth ? PORTRAIT_TUNING : LANDSCAPE_TUNING;

  const focal = () =>
    Math.min(frameHeight, frameWidth * FOCAL_WIDTH_FACTOR) * FOCAL_SCALE;

  /** One-point perspective: road (x, z) to screen position and scale. */
  const project = (x: number, z: number, tuning: SceneTuning) => {
    const f = focal();
    return {
      x: frameWidth / 2 + (f * x) / z,
      y: tuning.horizonFrac * frameHeight + (f * GROUND_DROP_FACTOR) / z,
      s: f / z,
    };
  };

  const glow = (
    x: number,
    y: number,
    radius: number,
    rgb: string,
    alpha: number,
  ) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, `rgba(${rgb},${alpha})`);
    g.addColorStop(0.4, `rgba(${rgb},${alpha * 0.35})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
  };

  const receding = Array.from({ length: RECEDING_CAR_COUNT }, (_, i) => ({
    z: 4 + i * 9,
    laneIndex: i % 2,
  }));
  const oncoming = Array.from({ length: ONCOMING_CAR_COUNT }, (_, i) => ({
    z: 8 + i * 12,
    laneIndex: i % 2,
  }));
  const bokeh = Array.from({ length: BOKEH_COUNT }, () => ({
    x: Math.random(),
    y: Math.random() * BOKEH_SKY_FRAC,
    radius: 1 + Math.random() * 2.5,
    phase: Math.random() * TAU,
  }));

  let startMs: number | null = null;
  let lastMs: number | null = null;
  let scroll = 0;

  const step = (nowMs: number): ContactProjection => {
    startMs ??= nowMs;
    const dt = lastMs === null ? 0 : Math.min(nowMs - lastMs, 50) / 1000;
    lastMs = nowMs;
    const loopMs = (nowMs - startMs) % BEAT_LOOP_MS;
    const tuning = activeTuning();
    const w = frameWidth;
    const h = frameHeight;
    scroll += dt * GRID_SCROLL_SPEED;

    // Sky, brightest in the band just below the horizon.
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#04050a");
    bg.addColorStop(tuning.horizonFrac, "#0a0c14");
    bg.addColorStop(1, "#05060a");
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Everything luminous stacks additively from here on.
    ctx.globalCompositeOperation = "lighter";
    const horizonGlow = ctx.createRadialGradient(
      w / 2,
      tuning.horizonFrac * h,
      0,
      w / 2,
      tuning.horizonFrac * h,
      w * 0.7,
    );
    horizonGlow.addColorStop(0, "rgba(255,170,80,0.11)");
    horizonGlow.addColorStop(0.5, "rgba(255,150,60,0.035)");
    horizonGlow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = horizonGlow;
    ctx.fillRect(0, 0, w, h * 0.85);

    for (const b of bokeh) {
      const alpha = 0.05 + 0.04 * Math.sin(nowMs / 900 + b.phase);
      glow(b.x * w, b.y * h, b.radius * 3, AMBER_RGB, alpha);
    }

    // Fixed lines converging on the vanishing point.
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${AMBER_RGB},${GRID_ALPHA})`;
    for (
      let x = -GRID_HALF_WIDTH;
      x <= GRID_HALF_WIDTH;
      x += LONGITUDINAL_SPACING
    ) {
      const near = project(x, tuning.nearZ, tuning);
      const far = project(x, GRID_FAR_Z, tuning);
      ctx.beginPath();
      ctx.moveTo(near.x, near.y);
      ctx.lineTo(far.x, far.y);
      ctx.stroke();
    }

    // Cross lines scrolling toward the viewer.
    const crossRange = CROSS_LINE_COUNT * CROSS_SPACING;
    for (let i = 0; i < CROSS_LINE_COUNT; i++) {
      const z =
        tuning.nearZ +
        ((((i * CROSS_SPACING - scroll) % crossRange) + crossRange) %
          crossRange);
      if (z > GRID_FAR_Z) continue;
      const left = project(-GRID_HALF_WIDTH, z, tuning);
      const right = project(GRID_HALF_WIDTH, z, tuning);
      const fade = Math.max(0, 1 - z / TRAFFIC_FAR_Z);
      ctx.strokeStyle = `rgba(${AMBER_RGB},${GRID_ALPHA * fade})`;
      ctx.beginPath();
      ctx.moveTo(left.x, left.y);
      ctx.lineTo(right.x, right.y);
      ctx.stroke();
    }

    // Receding traffic: red taillight pairs shrinking toward the horizon,
    // each dragging a motion trail back toward the camera.
    for (const car of receding) {
      car.z += dt * RECEDING_SPEED;
      if (car.z > TRAFFIC_FAR_Z) car.z = RECEDING_RESET_Z;
      const fade = Math.max(0.12, 1 - car.z / TRAFFIC_FAR_Z);
      const lane = tuning.recedingLanes[car.laneIndex];
      for (const side of [
        -tuning.recedingPairOffset,
        tuning.recedingPairOffset,
      ]) {
        const p = project(lane + side, car.z, tuning);
        const trail = project(
          lane + side,
          Math.max(tuning.nearZ, car.z - TRAFFIC_TRAIL_Z),
          tuning,
        );
        ctx.strokeStyle = `rgba(${TAILLIGHT_RGB},${0.35 * fade})`;
        ctx.lineWidth = Math.max(1, p.s * 0.05);
        ctx.beginPath();
        ctx.moveTo(trail.x, trail.y - trail.s * 0.22);
        ctx.lineTo(p.x, p.y - p.s * 0.22);
        ctx.stroke();
        glow(
          p.x,
          p.y - p.s * 0.22,
          Math.max(2, p.s * 0.11),
          TAILLIGHT_RGB,
          0.8 * fade,
        );
      }
    }

    // Oncoming traffic: warm-white headlight pairs streaking toward the
    // camera, each dragging a motion trail.
    for (const car of oncoming) {
      car.z -= dt * ONCOMING_SPEED;
      if (car.z < tuning.nearZ) car.z = TRAFFIC_FAR_Z;
      const fade = Math.max(0.1, 1 - car.z / TRAFFIC_FAR_Z);
      const lane = tuning.oncomingLanes[car.laneIndex];
      for (const side of [
        -tuning.oncomingPairOffset,
        tuning.oncomingPairOffset,
      ]) {
        const p = project(lane + side, car.z, tuning);
        const trail = project(lane + side, car.z + TRAFFIC_TRAIL_Z, tuning);
        ctx.strokeStyle = `rgba(${HEADLIGHT_RGB},${0.35 * fade})`;
        ctx.lineWidth = Math.max(1, p.s * 0.05);
        ctx.beginPath();
        ctx.moveTo(trail.x, trail.y - trail.s * 0.22);
        ctx.lineTo(p.x, p.y - p.s * 0.22);
        ctx.stroke();
        glow(
          p.x,
          p.y - p.s * 0.22,
          Math.max(2.5, p.s * 0.13),
          HEADLIGHT_RGB,
          0.85 * fade,
        );
      }
    }

    // Detection beat: the contact sweeps up the right shoulder.
    const contact = contactStateAt(loopMs, tuning);
    let projection: ContactProjection = null;
    if (contact.present) {
      const p = project(tuning.shoulderX, contact.z, tuning);
      const fade = Math.min(1, contact.progress * 4);
      glow(
        p.x,
        p.y - p.s * 0.3,
        Math.max(3, p.s * 0.24),
        CONTACT_BODY_RGB,
        0.35 * fade,
      );
      const redLeads = Math.floor(nowMs / STROBE_INTERVAL_MS) % 2 === 0;
      const barOffset = Math.max(2, p.s * 0.12);
      const barRadius = Math.max(2.5, p.s * 0.1);
      glow(
        p.x - barOffset,
        p.y - p.s * 0.52,
        barRadius,
        redLeads ? LIGHT_BAR_RED_RGB : LIGHT_BAR_BLUE_RGB,
        0.9 * fade,
      );
      glow(
        p.x + barOffset,
        p.y - p.s * 0.52,
        barRadius,
        redLeads ? LIGHT_BAR_BLUE_RGB : LIGHT_BAR_RED_RGB,
        0.9 * fade,
      );

      // Amber ripple right as the lock snaps on.
      if (contact.lockOn && contact.sinceLockMs < RIPPLE_MS) {
        const rippleProgress = contact.sinceLockMs / RIPPLE_MS;
        ctx.strokeStyle = `rgba(${AMBER_RGB},${0.35 * (1 - rippleProgress)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(
          p.x,
          p.y - p.s * 0.3,
          20 + rippleProgress * w * tuning.rippleWidthFrac,
          0,
          TAU,
        );
        ctx.stroke();
      }

      projection = {
        x: p.x,
        y: p.y - p.s * 0.42,
        size: Math.max(26, p.s * 0.6),
        lockOn: contact.lockOn,
        sinceLockMs: contact.sinceLockMs,
      };
    }

    return projection;
  };

  const resize = (nextWidth: number, nextHeight: number) => {
    frameWidth = nextWidth;
    frameHeight = nextHeight;
    applySize();
  };

  const dispose = () => {
    // Canvas 2D holds no GPU resources of its own; nothing to release.
  };

  return { step, resize, dispose };
};
