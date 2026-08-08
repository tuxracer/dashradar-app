import type { LucideIcon } from "lucide-react";

/**
 * A lucide glyph in static radar-scope rings, echoing the intro's animated scope
 * so full-screen panels read as part of the instrument. Purely decorative.
 */
export const ScopeGlyph = ({ icon: Icon }: { icon: LucideIcon }) => (
  <div className="relative flex aspect-square w-36 shrink-0 animate-scope-in items-center justify-center motion-reduce:animate-none landscape:w-44">
    <div className="absolute inset-0 animate-pulse rounded-full border border-hud-amber/30 motion-reduce:animate-none" />
    <div className="absolute inset-[14%] rounded-full border border-hud-amber/20" />
    <div className="absolute inset-x-0 top-1/2 h-px bg-hud-amber/10" />
    <div className="absolute inset-y-0 left-1/2 w-px bg-hud-amber/10" />
    <Icon
      className="relative h-14 w-14 text-hud-amber landscape:h-16 landscape:w-16"
      strokeWidth={1.25}
      aria-hidden
    />
  </div>
);
