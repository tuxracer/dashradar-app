// import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
import { useState, useEffect } from "react";
import * as tf from "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import memoizee from "memoizee";
import { Subject, pairwise, map, filter } from "rxjs";

export const UNKNOWN_THRESHOLD = 0.7;
export const OVERLAP_THRESHOLD_ID = 0.6;
export const OVERLAP_THRESHOLD_BBOX = 0.9;

export const MODEL_URLS: string[] = [
    "/models/base_v1/model.json",
    "/models/base_v1/group1-shard1of5",
    "/models/base_v1/group1-shard2of5",
    "/models/base_v1/group1-shard3of5",
    "/models/base_v1/group1-shard4of5",
    "/models/base_v1/group1-shard5of5",
];

// import { v4 as uuidv4 } from "uuid";

const allowList = [
    "person",

    "bicycle",
    "car",
    "truck",
    "motorcycle",
    "bus",

    "traffic light",
    "stop sign",
    "parking meter",

    "laptop",
    "bottle",

    "dog",
    "cat",
    "bird",
    "horse",
];

let count = 0;

const uuidv4 = () => {
    count += 1;
    return count.toString();
};

// setWasmPaths({
//     "tfjs-backend-wasm.wasm": "/tfjs-backend-wasm.wasm",
//     "tfjs-backend-wasm-simd.wasm": "/tfjs-backend-wasm-simd.wasm",
//     "tfjs-backend-wasm-threaded-simd.wasm":
//         "/tfjs-backend-wasm-threaded-simd.wasm",
// });

export type TensorFlowBackend = "webgl" | "wasm" | "cpu";

export type TensowFlowBase =
    | "mobilenet_v1"
    | "mobilenet_v2"
    | "lite_mobilenet_v2";

export const DEFAULT_TENSORFLOW_BACKEND: TensorFlowBackend = "webgl";

export const DEFAULT_TENSORFLOW_BASE: TensowFlowBase = "lite_mobilenet_v2";

export const setTensorflowBackend = memoizee(
    async (backend: TensorFlowBackend) => {
        await tf.setBackend(backend);
        await tf.ready();
    },
    { promise: true }
);

export const getTensorflowModel = memoizee(
    async (options: DetectedObjectOptions) => {
        const {
            tensorFlowBackend = DEFAULT_TENSORFLOW_BACKEND,
            tensorFlowBase: base = DEFAULT_TENSORFLOW_BASE,
        } = options;
        await setTensorflowBackend(tensorFlowBackend);
        if (base === "lite_mobilenet_v2") {
            return cocoSsd.load({ modelUrl: "/models/base_v1/model.json" });
        }
        return cocoSsd.load({ base });
    },
    { primitive: true, promise: true }
);

export const useTensorflowModel = (options: DetectedObjectOptions) => {
    const [model, setModel] = useState<cocoSsd.ObjectDetection | null>(null);
    useEffect(() => {
        getTensorflowModel(options).then(setModel);
    }, [options]);

    return model;
};

export interface DetectedObjectOptions {
    tensorFlowBackend?: TensorFlowBackend;
    tensorFlowBase?: TensowFlowBase;
}

export interface DetectedObject extends cocoSsd.DetectedObject {
    id?: string;
    overlap?: number;
    bbox: [number, number, number, number];
    timestamp: number;
}

/** Get the percentage of overlap between two bounding boxes */
const getOverlapPercentage = (
    bbox1: DetectedObject["bbox"],
    bbox2: DetectedObject["bbox"]
) => {
    const [x1, y1, width1, height1] = bbox1;
    const [x2, y2, width2, height2] = bbox2;

    const xOverlap = Math.max(
        0,
        Math.min(x1 + width1, x2 + width2) - Math.max(x1, x2)
    );
    const yOverlap = Math.max(
        0,
        Math.min(y1 + height1, y2 + height2) - Math.max(y1, y2)
    );

    const overlapArea = xOverlap * yOverlap;
    const bbox1Area = width1 * height1;
    const bbox2Area = width2 * height2;

    const overlapPercentage =
        overlapArea / (bbox1Area + bbox2Area - overlapArea);

    return overlapPercentage;
};

export const prefetchModelData = memoizee(
    (progressCb?: (progress: number) => void) => {
        if (typeof window === "undefined") return Promise.resolve();
        const totalCount = MODEL_URLS.length;
        const loaded: string[] = [];

        return Promise.all(
            MODEL_URLS.map((url) =>
                fetch(url, { cache: "force-cache" }).then(() => {
                    loaded.push(url);

                    const loadedCount = loaded.length;
                    const pendingCount = totalCount - loadedCount;
                    const progress =
                        Math.floor(100 - (pendingCount / totalCount) * 100) /
                        100;
                    progressCb?.(progress);
                })
            )
        );
    },
    { promise: true }
);

export const getDetectedObjects$ = memoizee(
    (
        videoEl: HTMLVideoElement | null,
        options: DetectedObjectOptions = {
            tensorFlowBackend: DEFAULT_TENSORFLOW_BACKEND,
            tensorFlowBase: DEFAULT_TENSORFLOW_BASE,
        }
    ) => {
        const detectedObjects$ = new Subject<DetectedObject[]>();

        /** If overlap is detected use the id from the object that is overlapped */
        const uniqueDetectedObjects$ = detectedObjects$.pipe(
            filter((detectedObjects) => detectedObjects.length > 0),
            pairwise(),
            map(([prevDetectedObjects, detectedObjects]) => {
                const uniqueDetectedObjects = detectedObjects.map(
                    (detectedObject) => {
                        const prevDetectedObjectsWithOverlap =
                            prevDetectedObjects
                                .map((prevDetectedObject) => {
                                    let overlap = 0;
                                    if (
                                        prevDetectedObject.class ===
                                        detectedObject.class
                                    ) {
                                        overlap = getOverlapPercentage(
                                            detectedObject.bbox,
                                            prevDetectedObject.bbox
                                        );
                                    }

                                    // console.log({
                                    //     overlap,
                                    //     prevDetectedObject,
                                    //     detectedObject,
                                    // });

                                    return {
                                        ...prevDetectedObject,
                                        overlap,
                                    };
                                })
                                .sort((a, b) => b.overlap - a.overlap);

                        const [mostOverlap] = prevDetectedObjectsWithOverlap;

                        const maxScore = Math.max(
                            detectedObject.score,
                            mostOverlap.score
                        );

                        // console.log({ mostOverlap, maxScore });

                        // console.log({ maxScore });

                        // const mostOverlapAge =
                        //     detectedObject.timestamp - mostOverlap.timestamp;

                        // if (
                        //     maxScore > UNKNOWN_THRESHOLD &&
                        //     mostOverlapAge < 500
                        // ) {
                        //     return mostOverlap;
                        // }

                        if (mostOverlap.overlap > OVERLAP_THRESHOLD_ID) {
                            detectedObject.id = mostOverlap.id;
                            detectedObject.score = maxScore;
                        }

                        if (
                            maxScore > UNKNOWN_THRESHOLD &&
                            mostOverlap.overlap > OVERLAP_THRESHOLD_BBOX
                        ) {
                            detectedObject.bbox = mostOverlap.bbox;
                        }

                        return detectedObject;
                    }
                );
                // .filter(({ score }) => score > 0.5);

                return uniqueDetectedObjects;
            })
        );

        const detectFromVideoFrame = async (model: cocoSsd.ObjectDetection) => {
            let detectedObjects: DetectedObject[] | null = null;

            if (!videoEl) {
                detectedObjects$.error("No video element provided");
                return;
            }

            // const startTimestamp = performance.now();
            try {
                detectedObjects$.next([]);
                // @ts-ignore
                detectedObjects = await model.detect(videoEl);

                if (detectedObjects) {
                    const detectedObjectsWithId = detectedObjects
                        .filter((d) =>
                            allowList.includes(d.class.toLowerCase())
                        )
                        .map((d) => {
                            return {
                                ...d,
                                id: uuidv4(),
                                timestamp: Date.now(),
                            };
                        });
                    detectedObjects$.next(detectedObjectsWithId);
                } else {
                    detectedObjects$.next([]);
                }
            } catch (error) {
                console.warn("Unable to detect objects in video frame", error);
                detectedObjects$.error(error);
            }
            // const endTimestamp = performance.now();
            // const elapsedTimeMs = Math.round(endTimestamp - startTimestamp);

            // console.log({ elapsedTimeMs });

            /** await exactly 1 next frame, every 3rd frame you jump to latest available frame  */
            videoEl.requestVideoFrameCallback(() => {
                detectFromVideoFrame(model);
            });
        };

        getTensorflowModel(options).then((model) => {
            if (typeof requestIdleCallback === "undefined") {
                detectFromVideoFrame(model);
                return;
            }

            requestIdleCallback(() => {
                detectFromVideoFrame(model);
            });
        });

        return uniqueDetectedObjects$;
    },
    {
        normalizer: ([videoEl, options]) => {
            return `${videoEl?.id}` + `${JSON.stringify(options)}`;
        },
    }
);
