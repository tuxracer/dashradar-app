import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  FogExp2,
  Group,
  LineBasicMaterial,
  LineSegments,
  PerspectiveCamera,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import {
  AMBER,
  BEAT_LOOP_MS,
  BLIP_COUNT,
  BLOOM_RADIUS,
  BLOOM_STRENGTH,
  BLOOM_THRESHOLD,
  CONTACT_APPEAR_MS,
  CONTACT_EXIT_MS,
  CONTACT_LANE_X_PER_ASPECT,
  CONTACT_PASS_Z,
  CONTACT_SPAWN_Z,
  DPR_CAP,
  FOG_DENSITY,
  GRID_DEPTH,
  GRID_HALF_WIDTH,
  GRID_SCROLL_SPEED,
  GRID_SPACING,
  LOCK_FAR_Z,
  LOCK_NEAR_Z,
  SCENE_BACKGROUND,
} from "./consts";

/**
 * Where the police contact is (if anywhere) at a given time within the loop.
 * Depth only; the lateral lane is aspect-dependent and applied by the scene.
 */
export type ContactState =
  | { present: false }
  | {
      present: true;
      z: number;
      lockOn: boolean;
      /** ms since the lock window opened this pass; drives the snap animation. */
      sinceLockMs: number;
    };

/** Pure timeline: contact position and lock status for a loop-relative time. */
export const contactStateAt = (loopMs: number): ContactState => {
  const t = ((loopMs % BEAT_LOOP_MS) + BEAT_LOOP_MS) % BEAT_LOOP_MS;
  if (t < CONTACT_APPEAR_MS || t > CONTACT_EXIT_MS) return { present: false };
  const progress =
    (t - CONTACT_APPEAR_MS) / (CONTACT_EXIT_MS - CONTACT_APPEAR_MS);
  const z = CONTACT_SPAWN_Z + progress * (CONTACT_PASS_Z - CONTACT_SPAWN_Z);
  const lockOn = z >= LOCK_FAR_Z && z <= LOCK_NEAR_Z;
  const lockProgress =
    (LOCK_FAR_Z - CONTACT_SPAWN_Z) / (CONTACT_PASS_Z - CONTACT_SPAWN_Z);
  const lockOpensAtMs =
    CONTACT_APPEAR_MS + lockProgress * (CONTACT_EXIT_MS - CONTACT_APPEAR_MS);
  return {
    present: true,
    z,
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

/** Soft radial glow texture shared by every blip sprite. */
const createGlowTexture = (): CanvasTexture => {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.4)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new CanvasTexture(canvas);
};

/** Line segments for the fixed lines converging on the vanishing point. */
const createLongitudinalLines = (material: LineBasicMaterial): LineSegments => {
  const positions: number[] = [];
  for (let x = -GRID_HALF_WIDTH; x <= GRID_HALF_WIDTH; x += 1.5) {
    positions.push(x, 0, 2, x, 0, -GRID_DEPTH);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  return new LineSegments(geometry, material);
};

/** Cross lines whose parent group's z-shift animates the forward scroll. */
const createCrossLines = (material: LineBasicMaterial): LineSegments => {
  const positions: number[] = [];
  for (let z = 0; z >= -GRID_DEPTH; z -= GRID_SPACING) {
    positions.push(-GRID_HALF_WIDTH, 0, z, GRID_HALF_WIDTH, 0, z);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  return new LineSegments(geometry, material);
};

type Blip = { sprite: Sprite; speed: number };

const createGlowSprite = (
  texture: CanvasTexture,
  color: number,
  scale: number,
): Sprite => {
  const sprite = new Sprite(
    new SpriteMaterial({
      map: texture,
      color,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
  sprite.scale.setScalar(scale);
  return sprite;
};

/**
 * Builds the wireframe night-drive scene. Returns null when WebGL is
 * unavailable so the caller can fall back to the static backdrop.
 */
export const createIntroScene = (
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): IntroSceneHandle | null => {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_CAP));
  renderer.setSize(width, height, false);

  const scene = new Scene();
  scene.background = new Color(SCENE_BACKGROUND);
  scene.fog = new FogExp2(SCENE_BACKGROUND, FOG_DENSITY);

  const camera = new PerspectiveCamera(58, width / height, 0.1, 300);
  // The look-at point sits well below the ground plane so the camera pitches
  // down and the horizon rises to the upper third of a portrait frame,
  // keeping the grid (and the detection beat) out of the centered copy.
  camera.position.set(0, 1.5, 4);
  camera.lookAt(0, -8.2, -40);

  const gridMaterial = new LineBasicMaterial({
    color: AMBER,
    transparent: true,
    opacity: 0.32,
    fog: true,
  });
  const longitudinal = createLongitudinalLines(gridMaterial);
  const cross = createCrossLines(gridMaterial);
  const crossGroup = new Group();
  crossGroup.add(cross);
  scene.add(longitudinal, crossGroup);

  const glowTexture = createGlowTexture();
  const blips: Blip[] = Array.from({ length: BLIP_COUNT }, (_, i) => {
    const sprite = createGlowSprite(glowTexture, AMBER, 0.9);
    const lane = (i % 2 === 0 ? 1 : -1) * (0.8 + (i % 3) * 0.9);
    sprite.position.set(lane, 0.35, -8 - i * 14);
    scene.add(sprite);
    return { sprite, speed: i % 2 === 0 ? -7 : 14 };
  });

  const contactGroup = new Group();
  const contactBody = createGlowSprite(glowTexture, 0xb4bedd, 1.4);
  const lightRed = createGlowSprite(glowTexture, 0xff2828, 0.7);
  const lightBlue = createGlowSprite(glowTexture, 0x4a6eff, 0.7);
  lightRed.position.set(-0.35, 0.75, 0);
  lightBlue.position.set(0.35, 0.75, 0);
  contactGroup.add(contactBody, lightRed, lightBlue);
  contactGroup.visible = false;
  scene.add(contactGroup);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new Vector2(width / 2, height / 2),
    BLOOM_STRENGTH,
    BLOOM_RADIUS,
    BLOOM_THRESHOLD,
  );
  composer.addPass(bloom);

  let viewWidth = width;
  let viewHeight = height;
  let startMs: number | null = null;
  let lastMs: number | null = null;
  const projected = new Vector3();

  const step = (nowMs: number): ContactProjection => {
    startMs ??= nowMs;
    const dt = lastMs === null ? 0 : Math.min(nowMs - lastMs, 50) / 1000;
    lastMs = nowMs;
    const loopMs = (nowMs - startMs) % BEAT_LOOP_MS;

    crossGroup.position.z =
      (crossGroup.position.z + dt * GRID_SCROLL_SPEED) % GRID_SPACING;

    for (const blip of blips) {
      blip.sprite.position.z += dt * blip.speed;
      if (blip.sprite.position.z > 2) blip.sprite.position.z = -GRID_DEPTH;
      if (blip.sprite.position.z < -GRID_DEPTH) blip.sprite.position.z = -6;
    }

    const contact = contactStateAt(loopMs);
    contactGroup.visible = contact.present;
    let projection: ContactProjection = null;
    if (contact.present) {
      const laneX = CONTACT_LANE_X_PER_ASPECT * camera.aspect;
      contactGroup.position.set(laneX, 0.1, contact.z);
      const strobe = Math.floor(nowMs / 130) % 2 === 0;
      lightRed.material.opacity = strobe ? 1 : 0.15;
      lightBlue.material.opacity = strobe ? 0.15 : 1;
      projected.set(laneX, 0.55, contact.z).project(camera);
      projection = {
        x: (projected.x * 0.5 + 0.5) * viewWidth,
        y: (-projected.y * 0.5 + 0.5) * viewHeight,
        size: Math.max(28, (viewHeight * 2.2) / Math.abs(contact.z)),
        lockOn: contact.lockOn,
        sinceLockMs: contact.sinceLockMs,
      };
    }

    composer.render();
    return projection;
  };

  const resize = (nextWidth: number, nextHeight: number) => {
    viewWidth = nextWidth;
    viewHeight = nextHeight;
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(nextWidth, nextHeight, false);
    composer.setSize(nextWidth, nextHeight);
  };

  const dispose = () => {
    for (const blip of blips) blip.sprite.material.dispose();
    contactBody.material.dispose();
    lightRed.material.dispose();
    lightBlue.material.dispose();
    glowTexture.dispose();
    gridMaterial.dispose();
    longitudinal.geometry.dispose();
    cross.geometry.dispose();
    bloom.dispose();
    composer.dispose();
    renderer.dispose();
  };

  return { step, resize, dispose };
};
