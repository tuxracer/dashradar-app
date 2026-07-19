import type { RoadCategory } from "@/types";

/** Detections below this score are discarded. */
export const CONFIDENCE_THRESHOLD = 0.5;

/**
 * The nearest object gets the amber NEAR treatment once its box covers this
 * fraction of the frame. Tune on-device.
 */
export const NEAR_AREA_FRACTION = 0.06;

type RoadClass = { displayLabel: string; category: RoadCategory };

/** COCO labels shown on the HUD; every other class is detected but hidden. */
export const ROAD_CLASSES: Readonly<Record<string, RoadClass>> = {
  police: { displayLabel: "POLICE", category: "vehicle" },
  car: { displayLabel: "CAR", category: "vehicle" },
  truck: { displayLabel: "TRUCK", category: "vehicle" },
  bus: { displayLabel: "BUS", category: "vehicle" },
  motorcycle: { displayLabel: "MOTO", category: "bike" },
  bicycle: { displayLabel: "BIKE", category: "bike" },
  person: { displayLabel: "PERSON", category: "person" },
  "traffic light": { displayLabel: "SIGNAL", category: "signal" },
  "stop sign": { displayLabel: "STOP", category: "signal" },
  bird: { displayLabel: "ANIMAL", category: "animal" },
  cat: { displayLabel: "ANIMAL", category: "animal" },
  dog: { displayLabel: "ANIMAL", category: "animal" },
  horse: { displayLabel: "ANIMAL", category: "animal" },
  sheep: { displayLabel: "ANIMAL", category: "animal" },
  cow: { displayLabel: "ANIMAL", category: "animal" },
  bear: { displayLabel: "ANIMAL", category: "animal" },
  elephant: { displayLabel: "ANIMAL", category: "animal" },
  zebra: { displayLabel: "ANIMAL", category: "animal" },
  giraffe: { displayLabel: "ANIMAL", category: "animal" },
};
