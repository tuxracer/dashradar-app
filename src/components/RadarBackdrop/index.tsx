/**
 * Static radar-scope backdrop, the bottom layer of the HUD, so detections read
 * like blips on a grid. Purely decorative.
 *
 * The `-z-10` is load-bearing: this is positioned and opaque while the camera
 * `<video>` is in flow, so without it paint order draws the backdrop over the
 * video and the feed is never visible.
 */
export const RadarBackdrop = () => {
  return (
    <div
      className="pointer-events-none absolute inset-0 -z-10 bg-surface"
      style={{
        backgroundImage:
          "linear-gradient(rgba(255,179,64,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,179,64,0.07) 1px, transparent 1px)",
        backgroundSize: "40px 40px",
      }}
    />
  );
};
