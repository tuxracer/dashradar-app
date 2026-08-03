import type { RoadCategory } from "@/types";

/** Detections below this score are discarded. */
export const CONFIDENCE_THRESHOLD = 0.5;

/**
 * Box and label color per category in the detection view. Keyed on category
 * rather than on the class name so a new class inherits a color with no edit
 * here, which is the point of categories existing at all. These are CSS color
 * strings applied as inline styles rather than Tailwind classes, because
 * Tailwind cannot build a class name from a runtime value. Amber matches the
 * rest of the HUD and stays on vehicles, the case the app is built around; the
 * others are picked to stay apart from it and from each other on a bright
 * daytime feed. This is a developer-only view, so it can carry more color than
 * the driver-facing meter does.
 */
export const CATEGORY_COLORS: Readonly<Record<RoadCategory, string>> = {
  vehicle: "rgb(255, 179, 64)",
  person: "rgb(80, 220, 255)",
  bike: "rgb(140, 240, 140)",
  signal: "rgb(255, 120, 200)",
  animal: "rgb(200, 160, 255)",
  unknown: "rgb(170, 170, 170)",
};
