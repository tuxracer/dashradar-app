import { isNumber, isPlainObject, isString } from "remeda";

/** Box coordinates as 0-1 fractions of the frame (transformers.js `percentage: true`). */
export type NormalizedBox = {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
};

export const isNormalizedBox = (value: unknown): value is NormalizedBox => {
  return (
    isPlainObject(value) &&
    isNumber(value.xmin) &&
    isNumber(value.ymin) &&
    isNumber(value.xmax) &&
    isNumber(value.ymax)
  );
};

/** One detection as produced by the object-detection pipeline. */
export type RawDetection = {
  label: string;
  score: number;
  box: NormalizedBox;
};

export const isRawDetection = (value: unknown): value is RawDetection => {
  return (
    isPlainObject(value) &&
    isString(value.label) &&
    isNumber(value.score) &&
    isNormalizedBox(value.box)
  );
};

export type RoadCategory = "vehicle" | "person" | "bike" | "signal" | "animal";

/** A road-relevant detection enriched for HUD display. */
export type Detection = {
  label: string;
  displayLabel: string;
  category: RoadCategory;
  score: number;
  box: NormalizedBox;
};
