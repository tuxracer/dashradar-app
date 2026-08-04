/** True when the user asked the OS for reduced motion; guarded for jsdom. */
export const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
