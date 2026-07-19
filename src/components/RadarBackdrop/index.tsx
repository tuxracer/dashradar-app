/**
 * Static radar-scope backdrop rendered as the bottom layer of the HUD. It sits
 * behind the camera feed and becomes the visible background when the video feed
 * is toggled off, so detections read like blips on a radar grid. Purely
 * decorative and ignores pointer events. Rendered always (not conditionally) so
 * it never flashes in or out as the toggle flips.
 */
export const RadarBackdrop = () => {
  return (
    <div
      className="pointer-events-none absolute inset-0 bg-surface"
      style={{
        backgroundImage:
          "linear-gradient(rgba(255,179,64,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,179,64,0.07) 1px, transparent 1px)",
        backgroundSize: "40px 40px",
      }}
    />
  );
};
