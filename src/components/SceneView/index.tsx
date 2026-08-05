import { Component, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { RootState } from "@react-three/fiber";
import type { Group, Mesh, Object3D } from "three";
import type { Track } from "@/context/DetectionContext";
import type { Size } from "@/lib/detection";
import { createRadarBeeper } from "@/lib/radarAudio";
import { placeTracks } from "@/lib/scenePlacement";
import type { ScenePlacement } from "@/lib/scenePlacement";
import { prefersReducedMotion } from "@/utils/prefersReducedMotion";
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
  GRID_COLOR,
  GRID_DIVISIONS,
  GRID_OPACITY,
  GRID_SIZE_M,
  SURFACE_COLOR,
  TEST_PLACEMENTS,
  TWEEN_MS,
} from "./consts";
import { SceneGlyph } from "./glyphs";

export * from "./consts";

/** Props for SceneView. */
type SceneViewProps = {
  /** The published tracker output (scan.tracks): stable ids, coasted boxes. */
  tracks: Track[];
  /**
   * Native size of the frame the tracks' boxes are normalized to. Placements
   * recompute when the published scan changes (a fresh tracks array per
   * result); scene-gate skips republish nothing here on purpose, because a
   * scene that did not change cannot have moved its objects.
   */
  frame?: Size;
  /** Camera horizontal field of view in degrees (the sceneFov setting). */
  fovDeg: number;
  /** Current raw signal strength in [0, 1] (see hudSignal); drives the beeper. */
  confidence: number;
  /** Whether the beeping audio indicator is on (the radarAudio setting). */
  audioEnabled: boolean;
  /** Whether detection has not started yet (model loading, session warm-up). */
  initializing?: boolean;
  /**
   * Whether to render the fixed sample objects (the Scene test objects
   * developer option), one of each kind at known positions, alongside
   * anything really detected.
   */
  testObjects?: boolean;
  /**
   * Whether to show the scene diagnostics panel (the Debug overlay developer
   * option): the WebGL probe verdict and GPU name, the framebuffer size, a
   * live rendered-frame count, and recent context or error events. Exists so
   * a phone can report why its canvas is blank on the glass itself, with no
   * remote-debugging setup.
   */
  debug?: boolean;
  /**
   * Called once when the scene cannot render at all: WebGL is unavailable, or
   * the context was lost and neither a restore nor a canvas remount brought
   * it back. The caller is expected to fall back to the radar view.
   */
  onRenderFailure: () => void;
};

/** What the WebGL probe learned: usability plus a line for the debug panel. */
type WebglProbe = {
  ok: boolean;
  /** The GPU/driver string when ok, or the failure reason when not. */
  detail: string;
};

/**
 * Whether a WebGL2 context can be created at all, probed with the same
 * attributes the Canvas requests. Runs before the r3f Canvas ever mounts: the
 * Canvas throws where WebGL or ResizeObserver are missing (jsdom has
 * neither), so this probe is the seam that keeps the component renderable in
 * tests and lets real devices fail into the radar view instead of a crash.
 * The probe context is released immediately. The detail string feeds the
 * scene debug panel, so a phone can name its GPU or its refusal on the glass
 * without a remote-debugging setup.
 */
const probeWebgl = (): WebglProbe => {
  try {
    const canvas = document.createElement("canvas");
    let creationError = "";
    canvas.addEventListener("webglcontextcreationerror", (event) => {
      // Typed as a plain Event; the WebGLContextEvent statusMessage needs a
      // structural check.
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
 * Multiply every glyph material's authored opacity by a fade factor. The
 * authored value rides along in material.userData.baseOpacity so fading is
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
 * Catches render-time errors from the canvas subtree and routes them into the
 * scene's failure ladder. Without it a throw inside the r3f Canvas (a WebGL
 * context the device refuses to create, a driver rejecting a shader) unmounts
 * the entire app, because no boundary exists above this one; a detector must
 * degrade to the radar dial, never to a black screen. React's root
 * onCaughtError still reports the error to Sentry; the console line is for a
 * device being watched over remote debugging. A class because error
 * boundaries have no hook form.
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
 * Counts frames the canvas actually renders, written straight to a DOM node
 * in the scene debug panel. Rendered only while the panel is up; a demand
 * frameloop means the subscription itself schedules nothing. The count is
 * the panel's sharpest signal: zero frames on a black canvas means three
 * never drew, while a climbing count means the GPU is drawing and the black
 * is in presentation, two entirely different bugs.
 */
const DebugFrameProbe = ({
  target,
}: {
  target: RefObject<HTMLSpanElement | null>;
}) => {
  const frames = useRef(0);
  // Ref writes from a rAF-driven callback, off React's render path; the
  // immutability lint cannot see that useFrame is not render.
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
  /** Latest placement, kept for the glyph's kind and elevation. */
  placement: ScenePlacement;
  from: [number, number, number];
  to: [number, number, number];
  /** performance.now() when the current position tween started. */
  tweenStart: number;
  /** Fade lifecycle: entering, settled, or leaving after its track died. */
  phase: "in" | "live" | "out";
  /** performance.now() when the current phase started. */
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
 * The glyphs and their animator. Lives inside the Canvas because it needs
 * invalidate(): the canvas runs frameloop="demand", so nothing renders unless
 * something asks, and this is the only thing that asks. Each new set of
 * placements diffs against the live motion map (new ids fade in, moved ids
 * retarget their tween from wherever they currently are, absent ids fade
 * out), then invalidates once; the frame loop advances every active tween and
 * re-invalidates only while any remains unfinished, so the last settling
 * frame is the last frame drawn and a static scene costs zero GPU work until
 * the next scan. That self-parking invalidation is the thermal contract of
 * this view; never replace it with frameloop="always" or an unconditional
 * invalidate. Under reduced motion every change snaps in a single frame.
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

  // The frame loop advances motion state the diff effect created. Mutating
  // ref-held animation state from a rAF-driven callback is the same
  // imperative pattern as the radar screen's meter loop; the immutability
  // lint cannot see that useFrame runs off React's render path.
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
                // Position a freshly mounted glyph before its first frame so
                // it never flashes at the origin.
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
 * The user-facing 3D scene: detected objects placed on a ground plane in
 * ego-relative meters, rendered as low-poly glyphs under a chase camera. The
 * rendering register is deliberately abstract because the placement math is
 * coarse: range comes from a per-class height prior through a pinhole model
 * (see lib/scenePlacement) and is good to tens of percent, while bearing is
 * accurate, so glyphs and a fogged grid claim exactly as much as the data
 * supports. Glyph motion is tracker-truth: objects appear when a scan places
 * them, glide to each new fix, and fade out after their track dies, which
 * means positions update at the scan cadence (1 to 5 s) rather than
 * continuously, and the radar dial's peak-hold decay will briefly disagree
 * with this view by design.
 *
 * Thermal behavior mirrors the radar screen's parked loop: the canvas runs
 * frameloop="demand" with a dpr ceiling and a low-power context, glyph
 * animation re-invalidates only while a tween or fade is unfinished (see
 * SceneGlyphs), and the beeper's driver loop parks whenever the signal is
 * silent and is woken by prop changes, so an idle scanning session schedules
 * no animation frames and renders nothing. The beeper lives exactly as long
 * as this view and is fed the raw signal, matching the radar screen's audio
 * contract.
 *
 * Render failure has a three-rung ladder for the thermally stressed phones
 * this app runs on: a lost WebGL context first waits for the browser's
 * restore, then remounts the canvas once, and only then reports
 * onRenderFailure, which the app answers by switching the view mode back to
 * the radar dial. Where WebGL is missing entirely (jsdom, or a broken GPU
 * process) the failure fires on mount and nothing renders.
 */
export const SceneView = ({
  tracks,
  frame,
  fovDeg,
  confidence,
  audioEnabled,
  initializing,
  testObjects,
  debug,
  onRenderFailure,
}: SceneViewProps) => {
  const [probe] = useState(probeWebgl);
  const glSupported = probe.ok;
  /** Recent context/error events shown in the debug panel, oldest first. */
  const [debugEvents, setDebugEvents] = useState<string[]>([]);
  /** Actual drawing-buffer size, set once the renderer exists. */
  const [createdInfo, setCreatedInfo] = useState<string>();
  const framesSpanRef = useRef<HTMLSpanElement>(null);

  // Rare by construction (context losses and errors), so the state churn a
  // long session could accumulate is bounded by the slice.
  const appendDebugEvent = (line: string) => {
    setDebugEvents((previous) => [...previous.slice(-3), line.slice(0, 140)]);
  };
  const [canvasKey, setCanvasKey] = useState(0);
  const failedRef = useRef(false);
  const remountedRef = useRef(false);
  const lossTimerRef = useRef<number | undefined>(undefined);
  const onRenderFailureRef = useRef(onRenderFailure);
  const confidenceRef = useRef(confidence);
  const audioEnabledRef = useRef(audioEnabled);
  // Restarts the beeper loop when it has parked itself on silence; a no-op
  // while the loop is already running, so the mirror effects call it freely.
  const wakeRef = useRef<() => void>(() => {});

  // Read once at mount: flipping the OS setting mid-session re-evaluates on
  // the next mount, same as the intro scene.
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);

  // Test objects render even before the first scan (no frame yet), so glyph
  // rendering can be judged on a device ahead of the camera and model.
  const placements = useMemo(() => {
    const placed = frame ? placeTracks({ tracks, frame, fovDeg }) : [];
    return testObjects ? [...placed, ...TEST_PLACEMENTS] : placed;
  }, [tracks, frame, fovDeg, testObjects]);

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

  // Mirror the beeper's inputs into refs and wake its parked loop on change,
  // the radar screen's pattern (refs may not be written during render).
  useEffect(() => {
    confidenceRef.current = confidence;
    wakeRef.current();
  }, [confidence]);

  useEffect(() => {
    audioEnabledRef.current = audioEnabled;
    wakeRef.current();
  }, [audioEnabled]);

  // The beeper and its driver live exactly as long as this view. The loop
  // exists because beep cadence is paced by repeated update calls at a steady
  // level; it parks the moment it feeds silence (which also arms the beeper's
  // own idle suspend) and the mirrors above wake it, so quiet scanning, the
  // dominant state of a drive, schedules no frames.
  useEffect(() => {
    const beeper = createRadarBeeper();
    let disposed = false;
    let running = false;
    let frame = 0;
    const tick = (now: number) => {
      const level = audioEnabledRef.current ? confidenceRef.current : 0;
      beeper.update(level, now);
      if (level === 0) {
        running = false;
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    const wake = () => {
      if (disposed || running) {
        return;
      }
      running = true;
      frame = window.requestAnimationFrame(tick);
    };
    wakeRef.current = wake;
    wake();
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      wakeRef.current = () => {};
      beeper.dispose();
    };
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(lossTimerRef.current);
    },
    [],
  );

  const topTrack = tracks.reduce<Track | undefined>(
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
    <div className="absolute inset-0 bg-surface" data-testid="scene-view">
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
          <fog attach="fog" args={[SURFACE_COLOR, FOG_NEAR_M, FOG_FAR_M]} />
          <gridHelper
            args={[GRID_SIZE_M, GRID_DIVISIONS, GRID_COLOR, GRID_COLOR]}
            position={[GRID_CENTER[0], GRID_CENTER[1], GRID_CENTER[2]]}
            material-transparent
            material-opacity={GRID_OPACITY}
          />
          <SceneGlyphs placements={placements} reducedMotion={reducedMotion} />
          {debug && <DebugFrameProbe target={framesSpanRef} />}
        </Canvas>
      </SceneErrorBoundary>
      {debug && (
        // Bottom-left, clear of the debug overlay panel top-left: both are
        // gated on the same showDebug setting, so they are always up together.
        <div className="pointer-events-none absolute bottom-14 left-3 z-10 flex flex-col gap-0.5 text-left font-mono text-[10px] leading-tight text-white/70">
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
      <div className="pointer-events-none absolute inset-x-0 bottom-[max(1.25rem,env(safe-area-inset-bottom))] flex justify-center">
        <span
          data-testid="scene-status"
          className={`whitespace-nowrap text-[13px] font-semibold uppercase tracking-[0.24em] ${
            topTrack ? "text-hud-amber" : "text-white/40"
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
