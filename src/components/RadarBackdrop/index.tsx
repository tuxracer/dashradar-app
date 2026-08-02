/**
 * Static radar-scope backdrop rendered as the bottom layer of the HUD, so
 * detections read like blips on a radar grid. Purely decorative and ignores
 * pointer events. Mounted whenever the driver-facing radar meter is showing;
 * the developer-only detection view replaces it with the live camera feed
 * instead of layering over it.
 *
 * The `-z-10` is load-bearing: this backdrop is `absolute` (positioned) and
 * opaque, while the camera `<video>` is a normal in-flow element. Without a
 * negative z-index, CSS paint order draws this positioned element on top of the
 * in-flow video and the feed is never visible. The negative z-index keeps the
 * backdrop below the video (and below the HUD overlays) but above `<main>`'s own
 * background.
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
