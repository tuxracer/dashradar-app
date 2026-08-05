import { GlyphBox } from "../GlyphBox";
import { POLICE_LIGHTBAR_COLOR, VEHICLE_COLORS } from "./consts";
import type { VehicleKind } from "./types";

export * from "./consts";
export * from "./types";

/** A vehicle glyph: one body box, and for police a lightbar on the roof. */
export const VehicleGlyph = ({
  kind,
  width,
  height,
  length,
}: {
  kind: VehicleKind;
  width: number;
  height: number;
  length: number;
}) => (
  <>
    <GlyphBox
      color={VEHICLE_COLORS[kind]}
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
