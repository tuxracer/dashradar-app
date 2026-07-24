import { useEffect, useRef, useState } from "react";
import { STATIC_FRAME_MS } from "./consts";
import { createIntroScene } from "./scene";

export * from "./consts";
export type {
  ContactProjection,
  ContactState,
  IntroSceneHandle,
} from "./scene";

type IntroSceneProps = {
  /** Scene factory seam so jsdom tests can inject a fake (WebGL cannot run there). */
  createScene?: typeof createIntroScene;
};

/** True when the user asked the OS for reduced motion; guarded for jsdom. */
const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Full-screen three.js wireframe night-drive scene behind the intro copy,
 * including the center legibility scrim, which must paint above the canvas
 * but below the lock-on bracket (DOM order inside this component).
 * Owns the rAF loop, pauses while the page is hidden, renders one static
 * frame under reduced motion, and disposes GPU resources on unmount. When
 * WebGL is unavailable it renders nothing so the static RadarBackdrop
 * beneath stays visible. The lock-on bracket is a DOM overlay positioned
 * imperatively from the scene's per-frame contact projection (no React
 * state per frame).
 */
export const IntroScene = ({
  createScene = createIntroScene,
}: IntroSceneProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bracketRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const scene = createScene(
      canvas,
      container.clientWidth,
      container.clientHeight,
    );
    if (!scene) {
      setFailed(true);
      return;
    }

    if (prefersReducedMotion()) {
      scene.step(STATIC_FRAME_MS);
      return () => scene.dispose();
    }

    let frame = 0;
    const loop = (nowMs: number) => {
      const contact = scene.step(nowMs);
      const bracket = bracketRef.current;
      if (bracket) {
        if (contact?.lockOn) {
          const snap = Math.min(contact.sinceLockMs / 220, 1);
          const size = contact.size * (1 + (1 - snap) * 0.9);
          bracket.style.opacity = "1";
          bracket.style.width = `${size}px`;
          bracket.style.height = `${size * 0.8}px`;
          bracket.style.transform = `translate(${contact.x - size / 2}px, ${contact.y - (size * 0.8) / 2}px)`;
        } else {
          bracket.style.opacity = "0";
        }
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    const handleVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
      } else {
        frame = requestAnimationFrame(loop);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    const observer = new ResizeObserver(() => {
      scene.resize(container.clientWidth, container.clientHeight);
    });
    observer.observe(container);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", handleVisibility);
      observer.disconnect();
      scene.dispose();
    };
  }, [createScene]);

  if (failed) return null;

  const cornerGlow = "drop-shadow-[0_0_6px_rgba(255,179,64,0.8)]";

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <canvas ref={canvasRef} className="absolute inset-0 size-full" />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 52% at 50% 52%, rgba(5,6,10,0.85) 0%, rgba(5,6,10,0.4) 58%, transparent 80%)",
        }}
      />
      <div
        ref={bracketRef}
        className="absolute left-0 top-0 opacity-0 transition-opacity duration-150 will-change-transform"
      >
        <div
          className={`absolute left-0 top-0 size-1/4 border-l-2 border-t-2 border-hud-amber ${cornerGlow}`}
        />
        <div
          className={`absolute right-0 top-0 size-1/4 border-r-2 border-t-2 border-hud-amber ${cornerGlow}`}
        />
        <div
          className={`absolute bottom-0 left-0 size-1/4 border-b-2 border-l-2 border-hud-amber ${cornerGlow}`}
        />
        <div
          className={`absolute bottom-0 right-0 size-1/4 border-b-2 border-r-2 border-hud-amber ${cornerGlow}`}
        />
        <span className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold tracking-[0.22em] text-hud-amber [text-shadow:0_0_8px_rgba(255,179,64,0.7)]">
          CONTACT · 94%
        </span>
      </div>
    </div>
  );
};
