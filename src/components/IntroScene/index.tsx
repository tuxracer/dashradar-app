import { useEffect, useRef } from "react";
import { MAX_SCENE_DPR, STATIC_FRAME_TIME_S } from "./consts";
import { INTRO_FRAGMENT_SHADER, INTRO_VERTEX_SHADER } from "./shaders";
import type { IntroSceneRenderer } from "./types";

export * from "./consts";
export * from "./types";

/**
 * Creates the night-drive scene renderer inside the given container, or
 * returns null when WebGL2 is unavailable or shader setup fails. The factory
 * owns its canvas (created here, removed by dispose) so a StrictMode
 * mount/unmount/mount cycle gets a fresh context each time instead of
 * reusing one that dispose already released.
 */
export const createIntroSceneRenderer = (
  container: HTMLElement,
): IntroSceneRenderer | null => {
  const canvas = document.createElement("canvas");
  canvas.className = "size-full";
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      powerPreference: "low-power",
    });
  } catch {
    return null;
  }
  if (!gl) {
    return null;
  }
  const ctx = gl;

  const compile = (type: number, source: string): WebGLShader | null => {
    const shader = ctx.createShader(type);
    if (!shader) {
      return null;
    }
    ctx.shaderSource(shader, source);
    ctx.compileShader(shader);
    if (!ctx.getShaderParameter(shader, ctx.COMPILE_STATUS)) {
      console.warn(
        "intro scene shader failed to compile",
        ctx.getShaderInfoLog(shader),
      );
      ctx.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const vertex = compile(ctx.VERTEX_SHADER, INTRO_VERTEX_SHADER);
  const fragment = compile(ctx.FRAGMENT_SHADER, INTRO_FRAGMENT_SHADER);
  const program = ctx.createProgram();
  if (!vertex || !fragment || !program) {
    return null;
  }
  ctx.attachShader(program, vertex);
  ctx.attachShader(program, fragment);
  ctx.linkProgram(program);
  if (!ctx.getProgramParameter(program, ctx.LINK_STATUS)) {
    console.warn(
      "intro scene program failed to link",
      ctx.getProgramInfoLog(program),
    );
    return null;
  }
  ctx.useProgram(program);
  const uResolution = ctx.getUniformLocation(program, "uResolution");
  const uTime = ctx.getUniformLocation(program, "uTime");

  // A lost context mid-show is not recoverable in a way worth the code: the
  // scene is decorative and first-open only, so just drop the canvas and let
  // the RadarBackdrop grid show through for the rest of the intro.
  canvas.addEventListener("webglcontextlost", () => {
    canvas.remove();
  });

  container.appendChild(canvas);

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_SCENE_DPR);
    const width = Math.max(1, Math.round(container.clientWidth * dpr));
    const height = Math.max(1, Math.round(container.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  };

  const render = (timeS: number) => {
    if (ctx.isContextLost()) {
      return;
    }
    ctx.viewport(0, 0, canvas.width, canvas.height);
    ctx.uniform2f(uResolution, canvas.width, canvas.height);
    ctx.uniform1f(uTime, timeS);
    ctx.drawArrays(ctx.TRIANGLES, 0, 3);
  };

  const dispose = () => {
    ctx.getExtension("WEBGL_lose_context")?.loseContext();
    canvas.remove();
  };

  return { render, resize, dispose };
};

type IntroSceneProps = {
  /** Renderer factory seam for tests; defaults to the real WebGL factory. */
  createRenderer?: typeof createIntroSceneRenderer;
};

/**
 * Full-screen procedural night-drive scene behind the intro content: light
 * streaks rushing past a dark road while an amber scan wave sweeps the frame
 * and blooms a blip. Renders nothing (leaving the RadarBackdrop grid
 * visible) when WebGL2 is unavailable, and draws a single static frame under
 * prefers-reduced-motion. The animation loop pauses while the page is
 * hidden and the context is released on unmount, before the detection
 * worker's GPU session ramps up.
 */
export const IntroScene = ({
  createRenderer = createIntroSceneRenderer,
}: IntroSceneProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const renderer = createRenderer(container);
    if (!renderer) {
      return;
    }
    renderer.resize();

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reducedMotion) {
      renderer.render(STATIC_FRAME_TIME_S);
      return () => {
        renderer.dispose();
      };
    }

    let frameId = 0;
    const startedAt = performance.now();
    const loop = () => {
      renderer.render((performance.now() - startedAt) / 1_000);
      frameId = requestAnimationFrame(loop);
    };
    const handleVisibility = () => {
      cancelAnimationFrame(frameId);
      if (!document.hidden) {
        frameId = requestAnimationFrame(loop);
      }
    };
    const handleResize = () => {
      renderer.resize();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("resize", handleResize);
    frameId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frameId);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
    };
  }, [createRenderer]);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0 -z-10 animate-intro-fade motion-reduce:animate-none"
    />
  );
};
