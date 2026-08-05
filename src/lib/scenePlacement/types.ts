/** Object categories the 3D scene view knows how to place and draw. */
export type PlacedKind =
  | "police"
  | "car"
  | "truck"
  | "bus"
  | "person"
  | "bicycle"
  | "motorcycle"
  | "trafficLight";

/**
 * A real-world height assumption for one kind of object, plus the label
 * substrings that identify it. Matching is by lowercased substring so a
 * checkpoint's exact class names ("police car", "Police SUV") do not have to
 * be enumerated here.
 */
export type HeightPrior = {
  /** Kind this prior places the object as. */
  kind: PlacedKind;
  /** Lowercased substrings matched against the lowercased detection label. */
  terms: readonly string[];
  /** Assumed real-world height of the object in meters, used to range it. */
  heightM: number;
  /**
   * Height of the glyph's base above the ground in meters. Zero for anything
   * that sits on the road; nonzero for suspended objects like traffic lights.
   */
  elevationM: number;
};

/** One tracked object placed on the ground plane in ego-relative meters. */
export type ScenePlacement = {
  /** The source track's stable id, for keying scene objects across frames. */
  id: number;
  /** Kind resolved from the label via the height priors. */
  kind: PlacedKind;
  /** The detection label as the model produced it. */
  label: string;
  /** The track's smoothed confidence score. */
  score: number;
  /** Meters right of the camera axis (negative is left). */
  xM: number;
  /** Meters ahead along the camera axis (axial depth, not slant range). */
  zM: number;
  /** Height of the glyph's base above the ground in meters. */
  elevationM: number;
  /** Straight-line ground distance in meters, for readouts only. */
  rangeM: number;
  /** Bearing from the camera axis in radians (positive is right). */
  bearingRad: number;
};
