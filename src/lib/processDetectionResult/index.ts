import type { HudModel } from "@/lib/detection";
import { buildHudModel, enrichDetections } from "@/lib/detection";
import type { Track } from "@/lib/detectionTracker";
import type { ContactDirection } from "@/lib/radarSignal";
import { contactDirection, signalFromScore } from "@/lib/radarSignal";
import type {
  Detection,
  IdentifiedDetection,
  NormalizedBox,
  RawDetection,
} from "@/types";
import type { DetectionCrop } from "@/workers/detection/types";

/**
 * Latest detection cutout the radar detector mode renders on its contact
 * card.
 */
export type Contact = {
  /** The card image: a cutout of the detection. */
  image: ImageBitmap;
  /** Raw model score of the cropped detection. */
  score: number;
  /** Score remapped onto the meter's signal band (signalFromScore); the same
   * semantic as the dial readout so the two can never disagree. */
  signal: number;
  box: NormalizedBox;
  direction: ContactDirection;
  /** performance.now() when the result carrying this image arrived. */
  at: number;
};

/** Everything one detections result contributes to the UI. */
export type ProcessedDetectionResult = {
  /** The frame's detections after validation and the confidence filter, each
   * carrying the id of the object it re-detects. */
  detections: IdentifiedDetection[];
  /** The coasted tracker output (what the HUD renders), with stable ids. */
  tracked: Track[];
  hud: HudModel;
  /** Contact built from the crop, when it survived validation and is wanted. */
  contact: Contact | undefined;
  /**
   * Crop bitmap that arrived but produced no contact, which the caller must
   * close: an ImageBitmap holds GPU-adjacent memory that JS cannot reclaim.
   */
  discardedCrop: ImageBitmap | undefined;
};

/**
 * Turn one raw detections result into everything the UI consumes. Pure apart from
 * `identifyDetections`, so the whole per-result pipeline is testable without a
 * worker.
 * The crop goes through the same filter as the detections, so one whose detection
 * was filtered out is discarded rather than shown as evidence the HUD would not
 * count.
 */
export const processDetectionResult = ({
  detections: raw,
  crop,
  confidenceThreshold,
  identifyDetections,
  includeContact,
  at,
}: {
  detections: RawDetection[];
  crop: DetectionCrop | undefined;
  confidenceThreshold: number;
  identifyDetections: (detections: Detection[]) => {
    detections: IdentifiedDetection[];
    tracks: Track[];
  };
  includeContact: boolean;
  at: number;
}): ProcessedDetectionResult => {
  const filtered = enrichDetections(raw, confidenceThreshold);
  const { detections, tracks: tracked } = identifyDetections(filtered);
  const hud = buildHudModel(tracked);
  let contact: Contact | undefined;
  let discardedCrop: ImageBitmap | undefined;
  if (crop) {
    const [cropDetection] = enrichDetections(
      [raw[crop.detectionIndex]],
      confidenceThreshold,
    );
    if (cropDetection && includeContact) {
      contact = {
        image: crop.image,
        score: cropDetection.score,
        signal: signalFromScore(cropDetection.score),
        box: cropDetection.box,
        direction: contactDirection(cropDetection.box),
        at,
      };
    } else {
      discardedCrop = crop.image;
    }
  }
  return { detections, tracked, hud, contact, discardedCrop };
};
