import type { HudModel } from "@/lib/detection";
import { buildHudModel, enrichDetections } from "@/lib/detection";
import type { Track } from "@/lib/detectionTracker";
import type { ContactDirection } from "@/lib/radarSignal";
import { contactDirection, signalFromScore } from "@/lib/radarSignal";
import type { Detection, NormalizedBox, RawDetection } from "@/types";
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
  /** Cropped detection's box. */
  box: NormalizedBox;
  /** Cropped detection's heading. */
  direction: ContactDirection;
  /** performance.now() when the result carrying this image arrived. */
  at: number;
};

/** Everything one detections result contributes to the UI. */
export type ProcessedDetectionResult = {
  /** The frame's detections after validation and the confidence filter. */
  detections: Detection[];
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
 * Turn one raw detections result into everything the UI consumes: the
 * filtered per-frame detections, the coasted tracker set, the HUD model, and
 * the contact card's content. Pure apart from `updateTracks`, whose state the
 * caller owns, so the whole per-result pipeline is testable without a worker
 * or a renderer.
 *
 * The crop is validated against the same enrichment and confidence filter as
 * the detections themselves: a crop whose indexed detection is missing or
 * filtered out is discarded rather than shown, so the card never presents
 * evidence the HUD pipeline would not count. `includeContact` covers a crop
 * that was already in flight when the detection image was turned off.
 */
export const processDetectionResult = ({
  detections: raw,
  crop,
  confidenceThreshold,
  updateTracks,
  includeContact,
  at,
}: {
  detections: RawDetection[];
  crop: DetectionCrop | undefined;
  confidenceThreshold: number;
  updateTracks: (detections: Detection[]) => Track[];
  includeContact: boolean;
  at: number;
}): ProcessedDetectionResult => {
  const detections = enrichDetections(raw, confidenceThreshold);
  const tracked = updateTracks(detections);
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
