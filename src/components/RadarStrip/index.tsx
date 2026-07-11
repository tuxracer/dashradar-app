import type { Blip } from "@/lib/detection";

type RadarStripProps = {
  blips: Blip[];
};

export const RadarStrip = ({ blips }: RadarStripProps) => {
  return (
    <div className="absolute bottom-[max(4.5%,env(safe-area-inset-bottom))] left-1/2 h-7 w-[46%] min-w-64 -translate-x-1/2 rounded-full border border-white/20 bg-black/60">
      <span className="absolute inset-y-1 left-1/3 w-px bg-white/15" />
      <span className="absolute inset-y-1 left-2/3 w-px bg-white/15" />
      {blips.map((blip, index) => (
        <span
          key={index}
          data-testid="blip"
          className={
            blip.near
              ? "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-hud-amber shadow-[0_0_10px_1px_rgba(255,179,64,0.7)]"
              : "absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90"
          }
          style={{ left: `${blip.x * 100}%` }}
        />
      ))}
    </div>
  );
};
