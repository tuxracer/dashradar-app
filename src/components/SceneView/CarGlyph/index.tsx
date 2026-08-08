import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { AdditiveBlending, NormalBlending } from "three";
import { GLASS_COLOR, UNIT_BOX, UNIT_PLANE } from "../consts";
import { glowFalloff } from "../glowTexture";
import { GlyphBox } from "../GlyphBox";
import { usePoliceStrobe } from "../policeStrobe";
import { Wheel } from "../Wheel";
import {
  CAR_COLOR,
  LIGHTBAR_GLOW_OPACITY,
  LIGHTBAR_POOL_OPACITY,
  POLICE_BODY_COLOR,
  POLICE_LIGHTBAR_BLUE,
  POLICE_LIGHTBAR_BLUE_DIM,
  POLICE_LIGHTBAR_RED,
  POLICE_LIGHTBAR_RED_DIM,
  POLICE_PANEL_COLOR,
  TAILLIGHT_COLOR,
} from "./consts";

export * from "./consts";

/** Wheel corners as (side, end) signs: left or right, by front or rear. */
const WHEEL_CORNERS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

/**
 * A box of light rather than a box of car: translucent and never occluding.
 * Additive over the car's own paint, plainly blended over the road, since
 * additive over the light palette's white ground is invisible.
 */
const GlowBox = ({
  color,
  opacity,
  additive,
  center,
  size,
}: {
  color: string;
  opacity: number;
  additive?: boolean;
  center: readonly [number, number, number];
  size: readonly [number, number, number];
}) => (
  <mesh
    geometry={UNIT_BOX}
    position={[center[0], center[1], center[2]]}
    scale={[size[0], size[1], size[2]]}
  >
    <meshBasicMaterial
      color={color}
      transparent
      opacity={opacity}
      depthWrite={false}
      blending={additive ? AdditiveBlending : NormalBlending}
      userData={{ baseOpacity: opacity }}
    />
  </mesh>
);

/**
 * The pool of light a flashing bar throws on the road. Soft edges are the whole
 * point, so where no texture can be built there is no pool rather than a
 * rectangle. Blended rather than additive, which adds nothing over white.
 */
const GlowPool = ({
  color,
  center,
  size,
}: {
  color: string;
  center: readonly [number, number, number];
  size: readonly [number, number];
}) => {
  const falloff = glowFalloff();
  if (!falloff) {
    return null;
  }
  return (
    <mesh
      geometry={UNIT_PLANE}
      position={[center[0], center[1], center[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={[size[0], size[1], 1]}
    >
      <meshBasicMaterial
        color={color}
        map={falloff}
        transparent
        opacity={LIGHTBAR_POOL_OPACITY}
        depthWrite={false}
        userData={{ baseOpacity: LIGHTBAR_POOL_OPACITY }}
      />
    </mesh>
  );
};

/** The two lamps of a lightbar: which side each sits on, and its two states. */
const LAMPS = [
  {
    phase: "red",
    side: -1,
    lit: POLICE_LIGHTBAR_RED,
    dark: POLICE_LIGHTBAR_RED_DIM,
  },
  {
    phase: "blue",
    side: 1,
    lit: POLICE_LIGHTBAR_BLUE,
    dark: POLICE_LIGHTBAR_BLUE_DIM,
  },
] as const;

/**
 * The roof lightbar: two lamps taking turns, a halo over whichever is lit, and a
 * pool of that color on the road. There is no actual light in this scene; what
 * sells it is all three changing color together.
 *
 * The one exception to this view's self-parking frame loop, bounded twice: only
 * while a patrol car is on screen, and once per flip rather than per frame.
 */
const PoliceLightbar = ({
  width,
  height,
  length,
}: {
  width: number;
  height: number;
  length: number;
}) => {
  const phase = usePoliceStrobe();
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    invalidate();
  }, [phase, invalidate]);

  const glow = phase === "red" ? POLICE_LIGHTBAR_RED : POLICE_LIGHTBAR_BLUE;

  return (
    <>
      {LAMPS.map((lamp) => (
        <GlyphBox
          key={lamp.phase}
          color={
            phase === undefined || phase === lamp.phase ? lamp.lit : lamp.dark
          }
          center={[lamp.side * width * 0.155, height + 0.15, length * 0.06]}
          size={[width * 0.31, 0.15, 0.28]}
        />
      ))}
      {phase !== undefined && (
        <>
          <GlowBox
            color={glow}
            opacity={LIGHTBAR_GLOW_OPACITY}
            additive
            center={[0, height + 0.15, length * 0.06]}
            size={[width * 0.86, 0.3, 0.46]}
          />
          <GlowPool
            color={glow}
            center={[0, 0.03, length * 0.06]}
            size={[width * 3.4, length * 1.9]}
          />
        </>
      )}
    </>
  );
};

/**
 * A car glyph, sized in meters. The hull is narrower than the stated width so
 * the wheels define it; tucking them inside hides them at any real range.
 *
 * Police get the black-and-white livery and the lightbar, which is what a driver
 * recognizes a patrol car by; livery always beats `color`, since tinting a
 * patrol car would erase the one thing the glyph exists to say. The white
 * panels go where the chase camera looks.
 */
export const CarGlyph = ({
  police,
  color: bodyColor,
  width,
  height,
  length,
}: {
  police?: boolean;
  /** Body paint, the object's minted identity color; default plain gray. */
  color?: string;
  width: number;
  height: number;
  length: number;
}) => {
  const color = police ? POLICE_BODY_COLOR : (bodyColor ?? CAR_COLOR);

  return (
    <>
      <GlyphBox
        color={color}
        center={[0, height * 0.44, 0]}
        size={[width * 0.88, height * 0.56, length]}
      />
      <GlyphBox
        color={color}
        center={[0, height * 0.86, length * 0.06]}
        size={[width * 0.74, height * 0.28, length * 0.46]}
      />
      <GlyphBox
        color={GLASS_COLOR}
        center={[0, height * 0.885, length * 0.06]}
        size={[width * 0.75, height * 0.15, length * 0.47]}
      />
      {WHEEL_CORNERS.map(([side, end]) => (
        <Wheel
          key={`wheel${side}${end}`}
          center={[side * width * 0.44, height * 0.26, end * length * 0.31]}
          diameter={height * 0.52}
          tread={width * 0.12}
        />
      ))}
      {[-1, 1].map((side) => (
        <GlyphBox
          key={`tail${side}`}
          color={TAILLIGHT_COLOR}
          center={[side * width * 0.29, height * 0.5, length * 0.5]}
          size={[width * 0.22, height * 0.09, 0.06]}
        />
      ))}
      {police && (
        <>
          {[-1, 1].map((side) => (
            <GlyphBox
              key={`door${side}`}
              color={POLICE_PANEL_COLOR}
              center={[side * width * 0.44, height * 0.5, length * 0.02]}
              size={[width * 0.03, height * 0.28, length * 0.44]}
            />
          ))}
          <GlyphBox
            color={POLICE_PANEL_COLOR}
            center={[0, height * 0.72, -length * 0.3]}
            size={[width * 0.72, 0.03, length * 0.28]}
          />
          <GlyphBox
            color={POLICE_PANEL_COLOR}
            center={[0, height * 1.0, length * 0.06]}
            size={[width * 0.7, 0.03, length * 0.44]}
          />
          <GlyphBox
            color={POLICE_PANEL_COLOR}
            center={[0, height * 0.35, length * 0.5]}
            size={[width * 0.34, height * 0.16, 0.05]}
          />
          <GlyphBox
            color={POLICE_BODY_COLOR}
            center={[0, height + 0.04, length * 0.06]}
            size={[width * 0.66, 0.07, 0.3]}
          />
          <PoliceLightbar width={width} height={height} length={length} />
        </>
      )}
    </>
  );
};
