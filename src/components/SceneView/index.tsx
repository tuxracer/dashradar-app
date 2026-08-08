import { Component, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Smartphone } from "lucide-react";
import type { RootState } from "@react-three/fiber";
import type { Group, Mesh, Object3D } from "three";
import type { Track } from "@/context/DetectionContext";
import type { Size } from "@/lib/detection";
import { tracksSeenAt } from "@/lib/detectionTracker";
import { placeTracks } from "@/lib/scenePlacement";
import type { ScenePlacement } from "@/lib/scenePlacement";
import { prefersReducedMotion } from "@/utils/prefersReducedMotion";
import { useOrientationAccess } from "@/utils/useOrientationAccess";
import { useRadarBeeper } from "@/utils/useRadarBeeper";
import {
  CAMERA_FAR_M,
  CAMERA_NEAR_M,
  CAMERA_TARGET,
  CHASE_CAMERA_FOV,
  CHASE_CAMERA_POSITION,
  CONTEXT_RESTORE_TIMEOUT_MS,
  DPR_MAX,
  FADE_IN_MS,
  FADE_OUT_MS,
  FOG_FAR_M,
  FOG_NEAR_M,
  GRID_CENTER,
  GRID_DIVISIONS,
  GRID_SIZE_M,
  TWEEN_MS,
} from "./consts";
import { CameraRig } from "./cameraRig";
import { SceneGlyph } from "./SceneGlyph";
import { useScenePalette } from "./scenePalette";

export * from "./consts";
export { orientationOffsets, orientationQuaternion } from "./cameraRig";
export { usePoliceStrobe } from "./policeStrobe";
export { useScenePalette } from "./scenePalette";

type SceneViewProps = {
  /** The published tracker output; this view drops the coasted ones. */
  tracks: Track[];
  /** Timestamp of the scan that produced `tracks`; a match means a live find. */
  scanAt?: number;
  /** Native size of the frame the tracks' boxes are normalized to. */
  frame?: Size;
  /** Camera horizontal field of view in degrees (the sceneFov setting). */
  fovDeg: number;
  /** Raw signal strength in [0, 1]; drives the beeper. */
  confidence: number;
  audioEnabled: boolean;
  /** Whether detection has not started yet (model loading, session warm-up). */
  initializing?: boolean;
  /**
   * Whether to show the scene diagnostics panel, so a phone can report why its
   * canvas is blank on the glass itself, with no remote-debugging setup.
   */
  debug?: boolean;
  /** Called once when the scene cannot render at all; fall back to the radar. */
  onRenderFailure: () => void;
};

/** What the WebGL probe learned: usability plus a line for the debug panel. */
type WebglProbe = {
  ok: boolean;
  /** The GPU/driver string when ok, or the failure reason when not. */
  detail: string;
};

/**
 * Whether a WebGL2 context can be created, with the attributes the Canvas
 * requests. The Canvas throws where WebGL or ResizeObserver are missing, so this
 * is the seam that keeps the component renderable in tests.
 */
const probeWebgl = (): WebglProbe => {
  try {
    const canvas = document.createElement("canvas");
    let creationError = "";
    canvas.addEventListener("webglcontextcreationerror", (event) => {
      // Typed as a plain Event; statusMessage needs a structural check.
      creationError =
        "statusMessage" in event && typeof event.statusMessage === "string"
          ? event.statusMessage
          : "context creation error";
    });
    const context = canvas.getContext("webgl2", {
      powerPreference: "low-power",
      antialias: true,
    });
    if (!context) {
      return { ok: false, detail: creationError || "webgl2 unavailable" };
    }
    const debugInfo = context.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(
      context.getParameter(
        debugInfo ? debugInfo.UNMASKED_RENDERER_WEBGL : context.RENDERER,
      ),
    );
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return { ok: true, detail: renderer };
  } catch (error) {
    return { ok: false, detail: String(error) };
  }
};

/** Three's own runtime brand for meshes, as a guard instead of a cast. */
const isMesh = (object: Object3D): object is Mesh =>
  (object as Mesh).isMesh === true;

/** Scene position for a placement: right stays x, ahead becomes negative z. */
const toScenePosition = (
  placement: ScenePlacement,
): [number, number, number] => [placement.xM, 0, -placement.zM];

/** The app's one-shot easing curve, approximated for JS-driven tweens. */
const easeOut = (t: number): number => 1 - (1 - t) ** 3;

/** Linear interpolation between two scene positions. */
const lerpPosition = (
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  t: number,
): [number, number, number] => [
  from[0] + (to[0] - from[0]) * t,
  from[1] + (to[1] - from[1]) * t,
  from[2] + (to[2] - from[2]) * t,
];

/**
 * Fade a glyph. The authored opacity rides in userData.baseOpacity, so this is
 * idempotent rather than compounding.
 */
const applyFade = (group: Group, fade: number) => {
  group.traverse((child) => {
    if (!isMesh(child) || Array.isArray(child.material)) {
      return;
    }
    const base = child.material.userData.baseOpacity;
    child.material.opacity = (typeof base === "number" ? base : 1) * fade;
  });
};

/**
 * Routes render-time errors from the canvas subtree into the failure ladder.
 * Without it a throw inside the Canvas unmounts the whole app, and a detector
 * must degrade to the dial rather than a black screen.
 */
class SceneErrorBoundary extends Component<
  { onError: (error: unknown) => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Scene render failed", error);
    this.props.onError(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Counts rendered frames straight into the debug panel's DOM node. The panel's
 * sharpest signal: zero frames on a black canvas means three never drew, while a
 * climbing count means the black is in presentation.
 */
const DebugFrameProbe = ({
  target,
}: {
  target: RefObject<HTMLSpanElement | null>;
}) => {
  const frames = useRef(0);
  // Off React's render path; the immutability lint cannot see that.
  /* eslint-disable react-hooks/immutability */
  useFrame(() => {
    frames.current += 1;
    const span = target.current;
    if (span) {
      span.textContent = String(frames.current);
    }
  });
  /* eslint-enable react-hooks/immutability */
  return null;
};

/** Per-glyph motion state the frame loop advances. */
type GlyphMotion = {
  /** Latest placement, for the glyph's kind and elevation. */
  placement: ScenePlacement;
  from: [number, number, number];
  to: [number, number, number];
  /** performance.now() when the current position tween started. */
  tweenStart: number;
  /** Fade lifecycle: entering, settled, or leaving after its track died. */
  phase: "in" | "live" | "out";
  phaseStart: number;
};

/** Position of a motion's tween at a moment, for retargeting mid-flight. */
const motionPositionAt = (
  motion: GlyphMotion,
  nowMs: number,
): [number, number, number] => {
  const t = Math.min(1, (nowMs - motion.tweenStart) / TWEEN_MS);
  return lerpPosition(motion.from, motion.to, easeOut(t));
};

/**
 * The glyphs and their animator, inside the Canvas because it needs invalidate().
 * The loop re-invalidates only while a tween is unfinished, so a static scene
 * costs nothing until the next scan. That self-parking invalidation is this
 * view's thermal contract, never frameloop="always".
 */
const SceneGlyphs = ({
  placements,
  reducedMotion,
}: {
  placements: ScenePlacement[];
  reducedMotion: boolean;
}) => {
  const invalidate = useThree((state) => state.invalidate);
  const motionsRef = useRef(new Map<number, GlyphMotion>());
  const groupsRef = useRef(new Map<number, Group>());
  const [glyphs, setGlyphs] = useState<ScenePlacement[]>([]);

  useEffect(() => {
    const now = performance.now();
    const motions = motionsRef.current;
    const seen = new Set<number>();
    for (const placement of placements) {
      seen.add(placement.id);
      const target = toScenePosition(placement);
      const existing = motions.get(placement.id);
      if (existing) {
        existing.from = reducedMotion
          ? target
          : motionPositionAt(existing, now);
        existing.to = target;
        existing.tweenStart = now;
        existing.placement = placement;
        if (existing.phase === "out") {
          // The track came back before its fade-out finished.
          existing.phase = "in";
          existing.phaseStart = now;
        }
      } else {
        motions.set(placement.id, {
          placement,
          from: target,
          to: target,
          tweenStart: now,
          phase: reducedMotion ? "live" : "in",
          phaseStart: now,
        });
      }
    }
    for (const [id, motion] of motions) {
      if (seen.has(id) || motion.phase === "out") {
        continue;
      }
      if (reducedMotion) {
        motions.delete(id);
      } else {
        motion.phase = "out";
        motion.phaseStart = now;
      }
    }
    setGlyphs([...motions.values()].map((motion) => motion.placement));
    invalidate();
  }, [placements, reducedMotion, invalidate]);

  // Mutating ref-held animation state off React's render path, the same pattern
  // as the radar screen's meter loop; the immutability lint cannot see that.
  /* eslint-disable react-hooks/immutability */
  useFrame(() => {
    const now = performance.now();
    const motions = motionsRef.current;
    let active = false;
    let anyDied = false;
    for (const [id, motion] of motions) {
      const t = Math.min(1, (now - motion.tweenStart) / TWEEN_MS);
      if (t < 1 && !reducedMotion) {
        active = true;
      }
      let fade = 1;
      if (motion.phase === "in") {
        const ft = Math.min(1, (now - motion.phaseStart) / FADE_IN_MS);
        fade = ft;
        if (ft >= 1) {
          motion.phase = "live";
        } else {
          active = true;
        }
      } else if (motion.phase === "out") {
        const ft = Math.min(1, (now - motion.phaseStart) / FADE_OUT_MS);
        fade = 1 - ft;
        if (ft >= 1) {
          motions.delete(id);
          anyDied = true;
        } else {
          active = true;
        }
      }
      const group = groupsRef.current.get(id);
      if (group) {
        group.position.set(...motionPositionAt(motion, now));
        applyFade(group, fade);
      }
    }
    if (anyDied) {
      setGlyphs([...motions.values()].map((motion) => motion.placement));
    }
    if (active) {
      invalidate();
    }
  });
  /* eslint-enable react-hooks/immutability */

  return (
    <group>
      {glyphs.map((placement) => (
        <group
          key={placement.id}
          ref={(group: Group | null) => {
            if (group) {
              groupsRef.current.set(placement.id, group);
              const motion = motionsRef.current.get(placement.id);
              if (motion) {
                // So a freshly mounted glyph never flashes at the origin.
                group.position.set(
                  ...motionPositionAt(motion, performance.now()),
                );
                applyFade(group, motion.phase === "in" ? 0 : 1);
              }
            } else {
              groupsRef.current.delete(placement.id);
            }
          }}
        >
          <SceneGlyph kind={placement.kind} elevationM={placement.elevationM} />
        </group>
      ))}
    </group>
  );
};

/**
 * The 3D scene: detected objects on a ground plane in ego-relative meters, as
 * low-poly glyphs under a chase camera. The abstract register is deliberate,
 * since range comes off a height prior and is good only to tens of percent.
 *
 * Glyph motion is last-scan truth, so this disagrees with the coasting dial by
 * design: a glyph left standing is a false statement about where something is.
 *
 * The one view that follows the phone's color scheme, so chrome drawn over it
 * picks its ink through the scene-light variant. Render failure has three rungs:
 * await a context restore, remount once, then report onRenderFailure.
 */
export const SceneView = ({
  tracks,
  scanAt,
  frame,
  fovDeg,
  confidence,
  audioEnabled,
  initializing,
  debug,
  onRenderFailure,
}: SceneViewProps) => {
  const [probe] = useState(probeWebgl);
  const glSupported = probe.ok;
  const palette = useScenePalette();
  /** Recent context/error events shown in the debug panel, oldest first. */
  const [debugEvents, setDebugEvents] = useState<string[]>([]);
  /** Actual drawing-buffer size, set once the renderer exists. */
  const [createdInfo, setCreatedInfo] = useState<string>();
  const framesSpanRef = useRef<HTMLSpanElement>(null);

  // Rare by construction, and the slice bounds what a long session accumulates.
  const appendDebugEvent = (line: string) => {
    setDebugEvents((previous) => [...previous.slice(-3), line.slice(0, 140)]);
  };
  const [canvasKey, setCanvasKey] = useState(0);
  const failedRef = useRef(false);
  const remountedRef = useRef(false);
  const lossTimerRef = useRef<number | undefined>(undefined);
  const onRenderFailureRef = useRef(onRenderFailure);

  // Lives exactly as long as this view.
  useRadarBeeper(confidence, audioEnabled);

  // Read once at mount, same as the intro scene.
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);

  // Only while the camera rig is live, since a driver who asked for reduced
  // motion has a view that would not pan with the phone anyway.
  const orientation = useOrientationAccess(!reducedMotion);

  // Only what the last scan actually saw. A glyph standing on the ground plane
  // says something is there now, which is a claim a coasted track no longer
  // supports, however useful coasting is to the meter.
  const liveTracks = useMemo(
    () => (scanAt === undefined ? [] : tracksSeenAt(tracks, scanAt)),
    [tracks, scanAt],
  );

  // Nothing to place until a scan has reported the frame the boxes describe,
  // which the pinhole math needs to turn a box into a range.
  const placements = useMemo(
    () => (frame ? placeTracks({ tracks: liveTracks, frame, fovDeg }) : []),
    [liveTracks, frame, fovDeg],
  );

  useEffect(() => {
    onRenderFailureRef.current = onRenderFailure;
  }, [onRenderFailure]);

  // One-shot failure reporting shared by the probe, the context-loss ladder,
  // and the error boundary, so no path can double-fire the fallback. Reads
  // only refs, so any render's copy behaves identically.
  const reportRenderFailure = () => {
    if (!failedRef.current) {
      failedRef.current = true;
      onRenderFailureRef.current();
    }
  };

  useEffect(() => {
    if (!glSupported) {
      reportRenderFailure();
    }
  }, [glSupported]);

  // While the debug panel is up, catch what remote debugging would normally
  // show: async errors from the renderer land on window, not in the boundary.
  useEffect(() => {
    if (!debug) {
      return;
    }
    const handleError = (event: ErrorEvent) => {
      appendDebugEvent(`error: ${event.message}`);
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
      appendDebugEvent(`rejection: ${String(event.reason)}`);
    };
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, [debug]);

  useEffect(
    () => () => {
      window.clearTimeout(lossTimerRef.current);
    },
    [],
  );

  const topTrack = liveTracks.reduce<Track | undefined>(
    (best, track) =>
      best === undefined || track.score > best.score ? track : best,
    undefined,
  );
  const topPlacement =
    topTrack && placements.find((placement) => placement.id === topTrack.id);

  if (!glSupported) {
    return null;
  }

  const handleCreated = (state: RootState) => {
    state.camera.lookAt(CAMERA_TARGET[0], CAMERA_TARGET[1], CAMERA_TARGET[2]);
    const context = state.gl.getContext();
    setCreatedInfo(
      `${context.drawingBufferWidth}x${context.drawingBufferHeight}`,
    );
    const element = state.gl.domElement;
    element.addEventListener("webglcontextlost", (event) => {
      // preventDefault tells the browser a restore is wanted; the timer is
      // the escalation ladder for when one never comes.
      event.preventDefault();
      appendDebugEvent("context lost");
      window.clearTimeout(lossTimerRef.current);
      lossTimerRef.current = window.setTimeout(() => {
        if (!remountedRef.current) {
          remountedRef.current = true;
          appendDebugEvent("remounting canvas");
          setCanvasKey((key) => key + 1);
        } else {
          reportRenderFailure();
        }
      }, CONTEXT_RESTORE_TIMEOUT_MS);
    });
    element.addEventListener("webglcontextrestored", () => {
      appendDebugEvent("context restored");
      window.clearTimeout(lossTimerRef.current);
      state.invalidate();
    });
  };

  return (
    // The ground is an inline style rather than a utility class because the
    // fog below has to fade to exactly this color, and one palette value
    // feeding both is what keeps them from drifting apart.
    <div
      className="absolute inset-0"
      style={{ backgroundColor: palette.surface }}
      data-testid="scene-view"
    >
      <SceneErrorBoundary
        onError={(error) => {
          appendDebugEvent(
            `boundary: ${error instanceof Error ? error.message : String(error)}`,
          );
          reportRenderFailure();
        }}
      >
        <Canvas
          key={canvasKey}
          frameloop="demand"
          dpr={[1, DPR_MAX]}
          gl={{ powerPreference: "low-power", antialias: true }}
          camera={{
            fov: CHASE_CAMERA_FOV,
            position: [
              CHASE_CAMERA_POSITION[0],
              CHASE_CAMERA_POSITION[1],
              CHASE_CAMERA_POSITION[2],
            ],
            near: CAMERA_NEAR_M,
            far: CAMERA_FAR_M,
          }}
          onCreated={handleCreated}
        >
          <fog attach="fog" args={[palette.surface, FOG_NEAR_M, FOG_FAR_M]} />
          <gridHelper
            args={[GRID_SIZE_M, GRID_DIVISIONS, palette.grid, palette.grid]}
            position={[GRID_CENTER[0], GRID_CENTER[1], GRID_CENTER[2]]}
            material-transparent
            material-opacity={palette.gridOpacity}
          />
          <SceneGlyphs placements={placements} reducedMotion={reducedMotion} />
          <CameraRig enabled={!reducedMotion} />
          {debug && <DebugFrameProbe target={framesSpanRef} />}
        </Canvas>
      </SceneErrorBoundary>
      {debug && (
        // Bottom-left, clear of the debug overlay panel top-left: both are
        // gated on the same showDebug setting, so they are always up together.
        <div className="pointer-events-none absolute bottom-14 left-3 z-10 flex flex-col gap-0.5 text-left font-mono text-[10px] leading-tight text-white/70 scene-light:text-black/65">
          <span>{`gl: ${probe.ok ? "ok" : "FAIL"} · ${probe.detail}`}</span>
          <span>{`canvas: ${createdInfo ?? "-"} · dpr ${window.devicePixelRatio}`}</span>
          <span>
            {"frames: "}
            <span ref={framesSpanRef}>0</span>
          </span>
          {debugEvents.map((line, index) => (
            <span key={`${index}-${line}`}>{line}</span>
          ))}
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-[max(1.25rem,env(safe-area-inset-bottom))] flex flex-col items-center gap-3">
        {orientation.needsGesture && (
          // iOS hands over the orientation sensors only to a tap, which a
          // dash-mounted phone may never get, so the offer needs a control of its
          // own. It leaves for good on any answer.
          <button
            type="button"
            onClick={orientation.request}
            data-testid="scene-motion-ask"
            className="pointer-events-auto flex min-h-12 animate-rise-in items-center gap-2.5 rounded-full border border-white/25 bg-white/10 px-6 text-[13px] font-semibold uppercase tracking-[0.2em] text-white/85 active:scale-95 motion-reduce:animate-none scene-light:border-black/20 scene-light:bg-black/5 scene-light:text-black/75"
          >
            <Smartphone className="h-5 w-5" strokeWidth={2} />
            Enable tilt to look around
          </button>
        )}
        <span
          data-testid="scene-status"
          className={`whitespace-nowrap text-[13px] font-semibold uppercase tracking-[0.24em] ${
            topTrack
              ? "text-hud-amber scene-light:text-hud-amber-deep"
              : "text-white/40 scene-light:text-black/45"
          }`}
        >
          {topTrack
            ? topPlacement
              ? `${topTrack.label} · ${Math.round(topPlacement.rangeM)} m`
              : `${topTrack.label} detected`
            : initializing
              ? "Initializing"
              : "Scanning"}
        </span>
      </div>
    </div>
  );
};
