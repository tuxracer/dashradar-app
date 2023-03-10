import * as cocoSsd from "@tensorflow-models/coco-ssd";
import { Observable } from "rxjs";

export const getDetectedObjects$ = (
    model: cocoSsd.ObjectDetection,
    videoEl: HTMLVideoElement | null
) => {
    return new Observable<cocoSsd.DetectedObject[]>((subscriber) => {
        const detectFromVideoFrame = async () => {
            let detectedObjects: cocoSsd.DetectedObject[] | null = null;

            if (videoEl) {
                const startTimestamp = performance.now();
                try {
                    detectedObjects = await model.detect(videoEl);

                    if (detectedObjects) {
                        subscriber.next(detectedObjects);
                    }
                } catch (error) {
                    console.warn(
                        "Unable to detect objects in video frame",
                        error
                    );
                    subscriber.error(error);
                }
                const endTimestamp = performance.now();
                const elapsedTimeMs = Math.round(endTimestamp - startTimestamp);
            }
        };

        requestAnimationFrame(() => {
            detectFromVideoFrame();
        });
    });
};
