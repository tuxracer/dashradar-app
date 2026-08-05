import type { PlacedKind } from "@/lib/scenePlacement";
import { KIND_COLORS, POLICE_LIGHTBAR_COLOR } from "../consts";
import { GlyphBox } from "../GlyphBox";

/** A vehicle glyph: one body box, and for police a lightbar on the roof. */
export const VehicleGlyph = ({
  kind,
  width,
  height,
  length,
}: {
  kind: PlacedKind;
  width: number;
  height: number;
  length: number;
}) => (
  <>
    <GlyphBox
      color={KIND_COLORS[kind]}
      center={[0, height / 2, 0]}
      size={[width, height, length]}
    />
    {kind === "police" && (
      <GlyphBox
        color={POLICE_LIGHTBAR_COLOR}
        center={[0, height + 0.12, 0]}
        size={[width * 0.6, 0.22, 0.4]}
      />
    )}
  </>
);
